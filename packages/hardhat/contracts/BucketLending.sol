// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Minimal subset of Status Network's Karma interface we depend on.
///         `balanceOf` is the net Karma after any slashing and is the only
///         call we need. See https://docs.status.network/build-for-karma/guides/reputation-integration
interface IKarma {
    function balanceOf(address account) external view returns (uint256);
}

/// @title BucketLending
/// @notice Privacy-first, Karma-gated, stealth-operated lending.
///
/// Privacy model:
///   - Every on-chain action (requestLoan, fundLoan, repayLoan, cancelLoan,
///     markDefault) is authored by a stealth address. The primary identity
///     holding Karma never sends an on-chain transaction to this contract.
///   - To gate borrowing by Karma without linking the primary identity, the
///     Karma holder signs an off-chain EIP-712 `BorrowPermit` authorizing a
///     specific stealth to open a specific bucket. The stealth submits that
///     permit. The contract `ecrecover`s the signer, reads their Karma, and
///     verifies — but never stores or emits the signer's address.
///   - Replay is prevented by marking each permit digest as used. The digest
///     is a hash and does not reveal the signer.
///   - No Karma awards / no Karma slashing: the real Karma token on Status is
///     read-only from external contracts, and any on-chain identity tracking
///     would break the privacy guarantee.
///
/// What's still observable:
///   - The Karma-holder signature sits in the request transaction's calldata.
///     A determined observer can `ecrecover` it to recover the signer. Making
///     that link strongly private requires a ZK proof ("I know an address with
///     Karma ≥ N") and is out of scope here. Using a fresh `salt` per permit
///     prevents correlation across a single signer's loans.
contract BucketLending is EIP712, ReentrancyGuard {
    // ---------------- CONFIG ----------------

    IKarma public immutable karma;

    /// @dev Fixed borrow denominations (ascending).
    uint256[] public buckets;

    /// @dev Minimum Karma balance to borrow (18 decimals, matching real Karma ERC20).
    uint256 public constant MIN_KARMA = 1 ether;

    /// @dev ETH of borrow capacity granted per 1 Karma (18-decimal unit).
    uint256 public constant KARMA_BORROW_RATE = 0.05 ether;

    /// @dev Floor on interest after Karma-based discount (basis points).
    uint256 public constant MIN_INTEREST_BPS = 50; // 0.5%

    /// @dev Bps discount granted per 1 Karma, capped at the base rate.
    uint256 public constant INTEREST_DISCOUNT_BPS_PER_KARMA = 10; // 0.1%

    // ---------------- EIP-712 ----------------

    bytes32 private constant BORROW_PERMIT_TYPEHASH =
        keccak256(
            "BorrowPermit(address lending,address stealth,uint256 bucketAmount,uint256 baseInterestBps,uint256 duration,uint256 deadline,bytes32 salt)"
        );

    /// @dev Marks a specific permit digest as consumed.
    mapping(bytes32 => bool) public permitUsed;

    // ---------------- STATE ----------------

    enum Status {
        Open,
        Funded,
        Repaid,
        Defaulted,
        Cancelled
    }

    struct Loan {
        address borrowerStealth;
        uint256 bucketAmount;
        uint256 interestBps;
        uint256 duration;
        uint256 fundedAmount;
        uint256 fundedAt;
        uint256 dueTime;
        uint256 createdAt;
        Status status;
    }

    Loan[] private _loans;

    mapping(uint256 => address[]) private _lenders;
    mapping(uint256 => mapping(address => uint256)) private _contribution;

    // ---------------- EVENTS ----------------

    event LoanRequested(
        uint256 indexed loanId,
        address indexed borrowerStealth,
        uint256 bucketAmount,
        uint256 interestBps,
        uint256 duration
    );
    event LoanFunded(uint256 indexed loanId, address indexed lender, uint256 amount, uint256 totalFunded);
    event LoanFullyFunded(uint256 indexed loanId, uint256 dueTime);
    event LoanRepaid(uint256 indexed loanId, uint256 totalRepaid);
    event LoanDefaulted(uint256 indexed loanId);
    event LoanCancelled(uint256 indexed loanId);
    event LenderPaidOut(uint256 indexed loanId, address indexed lender, uint256 amount);

    // ---------------- ERRORS ----------------

    error InvalidBucket();
    error InvalidDuration();
    error InterestTooLow();
    error LowKarma();
    error ExceedsBorrowLimit();
    error CallerNotStealth();
    error PermitExpired();
    error PermitAlreadyUsed();
    error UnknownLoan();
    error WrongStatus();
    error NotBorrower();
    error InsufficientRepayment();
    error NotOverdue();
    error NothingToSend();
    error TransferFailed();

    // ---------------- CONSTRUCTOR ----------------

    constructor(address karmaAddress, uint256[] memory initialBuckets) EIP712("BucketLending", "1") {
        karma = IKarma(karmaAddress);
        require(initialBuckets.length > 0, "no buckets");
        for (uint256 i = 0; i < initialBuckets.length; i++) {
            if (i > 0) require(initialBuckets[i] > initialBuckets[i - 1], "buckets unsorted");
            buckets.push(initialBuckets[i]);
        }
    }

    // ---------------- PERMIT HELPERS ----------------

    /// @notice Exposes the EIP-712 domain separator so off-chain signers can verify.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice Computes the EIP-712 digest the Karma holder should sign.
    function hashBorrowPermit(
        address stealth,
        uint256 bucketAmount,
        uint256 baseInterestBps,
        uint256 duration,
        uint256 deadline,
        bytes32 salt
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                BORROW_PERMIT_TYPEHASH,
                address(this),
                stealth,
                bucketAmount,
                baseInterestBps,
                duration,
                deadline,
                salt
            )
        );
        return _hashTypedDataV4(structHash);
    }

    // ---------------- VIEWS ----------------

    function bucketsList() external view returns (uint256[] memory) {
        return buckets;
    }

    function maxBucket() public view returns (uint256) {
        return buckets[buckets.length - 1];
    }

    function isValidBucket(uint256 amount) public view returns (bool) {
        for (uint256 i = 0; i < buckets.length; i++) {
            if (buckets[i] == amount) return true;
        }
        return false;
    }

    /// @notice How much ETH a given Karma balance can borrow in a single bucket.
    function getMaxBorrow(uint256 karmaBalance) public pure returns (uint256) {
        return (karmaBalance * KARMA_BORROW_RATE) / 1 ether;
    }

    /// @notice Interest in basis points after Karma-based discount.
    function getAdjustedInterestBps(uint256 baseBps, uint256 karmaBalance) public pure returns (uint256) {
        uint256 discount = (karmaBalance * INTEREST_DISCOUNT_BPS_PER_KARMA) / 1 ether;
        if (discount >= baseBps) return MIN_INTEREST_BPS;
        uint256 adjusted = baseBps - discount;
        return adjusted < MIN_INTEREST_BPS ? MIN_INTEREST_BPS : adjusted;
    }

    function loansCount() external view returns (uint256) {
        return _loans.length;
    }

    function getLoan(uint256 loanId) external view returns (Loan memory) {
        if (loanId >= _loans.length) revert UnknownLoan();
        return _loans[loanId];
    }

    function getLoans() external view returns (Loan[] memory) {
        return _loans;
    }

    function getLenders(uint256 loanId) external view returns (address[] memory lenders, uint256[] memory amounts) {
        if (loanId >= _loans.length) revert UnknownLoan();
        address[] storage list = _lenders[loanId];
        lenders = list;
        amounts = new uint256[](list.length);
        for (uint256 i = 0; i < list.length; i++) {
            amounts[i] = _contribution[loanId][list[i]];
        }
    }

    function totalOwed(uint256 loanId) public view returns (uint256) {
        Loan storage l = _loans[loanId];
        return l.bucketAmount + (l.bucketAmount * l.interestBps) / 10_000;
    }

    // ---------------- CORE ----------------

    /// @notice Open a new loan against a stealth address, authorized by the
    ///         off-chain signature of a Karma holder. Must be called by the
    ///         stealth address itself — never by the Karma holder.
    function requestLoanWithPermit(
        address stealth,
        uint256 bucketAmount,
        uint256 baseInterestBps,
        uint256 duration,
        uint256 deadline,
        bytes32 salt,
        bytes calldata signature
    ) external returns (uint256 loanId) {
        if (msg.sender != stealth) revert CallerNotStealth();
        if (block.timestamp > deadline) revert PermitExpired();
        if (!isValidBucket(bucketAmount)) revert InvalidBucket();
        if (duration < 1 hours || duration > 365 days) revert InvalidDuration();
        if (baseInterestBps < MIN_INTEREST_BPS) revert InterestTooLow();

        bytes32 digest = hashBorrowPermit(stealth, bucketAmount, baseInterestBps, duration, deadline, salt);
        if (permitUsed[digest]) revert PermitAlreadyUsed();
        permitUsed[digest] = true;

        address signer = ECDSA.recover(digest, signature);
        uint256 karmaBalance = karma.balanceOf(signer);
        if (karmaBalance < MIN_KARMA) revert LowKarma();
        if (bucketAmount > getMaxBorrow(karmaBalance)) revert ExceedsBorrowLimit();

        uint256 adjustedBps = getAdjustedInterestBps(baseInterestBps, karmaBalance);

        loanId = _loans.length;
        _loans.push(
            Loan({
                borrowerStealth: stealth,
                bucketAmount: bucketAmount,
                interestBps: adjustedBps,
                duration: duration,
                fundedAmount: 0,
                fundedAt: 0,
                dueTime: 0,
                createdAt: block.timestamp,
                status: Status.Open
            })
        );

        emit LoanRequested(loanId, stealth, bucketAmount, adjustedBps, duration);
    }

    /// @notice Top up an open loan. When the target is reached the bucket is
    ///         sent to the stealth borrower in a single transfer. Overpayment
    ///         is refunded to the caller in-call.
    function fundLoan(uint256 loanId) external payable nonReentrant {
        if (loanId >= _loans.length) revert UnknownLoan();
        Loan storage loan = _loans[loanId];
        if (loan.status != Status.Open) revert WrongStatus();
        if (msg.value == 0) revert NothingToSend();

        uint256 remaining = loan.bucketAmount - loan.fundedAmount;
        uint256 accepted = msg.value > remaining ? remaining : msg.value;
        uint256 refund = msg.value - accepted;

        if (_contribution[loanId][msg.sender] == 0) {
            _lenders[loanId].push(msg.sender);
        }
        _contribution[loanId][msg.sender] += accepted;
        loan.fundedAmount += accepted;

        emit LoanFunded(loanId, msg.sender, accepted, loan.fundedAmount);

        if (loan.fundedAmount == loan.bucketAmount) {
            loan.status = Status.Funded;
            loan.fundedAt = block.timestamp;
            loan.dueTime = block.timestamp + loan.duration;
            emit LoanFullyFunded(loanId, loan.dueTime);
            _send(loan.borrowerStealth, loan.bucketAmount);
        }

        if (refund > 0) _send(msg.sender, refund);
    }

    /// @notice Repay principal + interest. Only the stealth borrower may call.
    function repayLoan(uint256 loanId) external payable nonReentrant {
        if (loanId >= _loans.length) revert UnknownLoan();
        Loan storage loan = _loans[loanId];
        if (loan.status != Status.Funded) revert WrongStatus();
        if (msg.sender != loan.borrowerStealth) revert NotBorrower();

        uint256 owed = totalOwed(loanId);
        if (msg.value < owed) revert InsufficientRepayment();

        loan.status = Status.Repaid;

        _distributeToLenders(loanId, owed);

        if (msg.value > owed) _send(msg.sender, msg.value - owed);

        emit LoanRepaid(loanId, owed);
    }

    /// @notice Cancel an Open loan and refund any contributors. Only the
    ///         stealth borrower may call (the Karma holder never appears).
    function cancelLoan(uint256 loanId) external nonReentrant {
        if (loanId >= _loans.length) revert UnknownLoan();
        Loan storage loan = _loans[loanId];
        if (loan.status != Status.Open) revert WrongStatus();
        if (msg.sender != loan.borrowerStealth) revert NotBorrower();

        loan.status = Status.Cancelled;

        address[] storage lenderList = _lenders[loanId];
        for (uint256 i = 0; i < lenderList.length; i++) {
            address lender = lenderList[i];
            uint256 amount = _contribution[loanId][lender];
            if (amount > 0) {
                _contribution[loanId][lender] = 0;
                _send(lender, amount);
                emit LenderPaidOut(loanId, lender, amount);
            }
        }

        emit LoanCancelled(loanId);
    }

    /// @notice Anyone can flag an overdue funded loan as defaulted. State change only —
    ///         we cannot slash Karma (the real Karma token is read-only from external
    ///         contracts) and storing the Karma holder's address would break privacy.
    function markDefault(uint256 loanId) external {
        if (loanId >= _loans.length) revert UnknownLoan();
        Loan storage loan = _loans[loanId];
        if (loan.status != Status.Funded) revert WrongStatus();
        if (block.timestamp <= loan.dueTime) revert NotOverdue();

        loan.status = Status.Defaulted;
        emit LoanDefaulted(loanId);
    }

    // ---------------- INTERNAL ----------------

    function _distributeToLenders(uint256 loanId, uint256 repaidTotal) internal {
        Loan storage loan = _loans[loanId];
        address[] storage lenderList = _lenders[loanId];
        uint256 principal = loan.bucketAmount;

        uint256 paid;
        for (uint256 i = 0; i < lenderList.length; i++) {
            address lender = lenderList[i];
            uint256 share = _contribution[loanId][lender];
            if (share == 0) continue;

            uint256 amount = i == lenderList.length - 1
                ? repaidTotal - paid // absorb rounding dust in the last payout
                : (repaidTotal * share) / principal;
            paid += amount;
            _contribution[loanId][lender] = 0;
            _send(lender, amount);
            emit LenderPaidOut(loanId, lender, amount);
        }
    }

    function _send(address to, uint256 amount) internal {
        (bool ok, ) = payable(to).call{ value: amount }("");
        if (!ok) revert TransferFailed();
    }
}
