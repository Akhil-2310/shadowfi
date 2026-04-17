import { expect } from "chai";
import { ethers } from "hardhat";
import { AbiCoder, keccak256, parseEther, toUtf8Bytes } from "ethers";
import { BucketLending, MockKarma } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const BUCKETS = [parseEther("0.1"), parseEther("0.5"), parseEther("1")];

const KARMA = (n: number | bigint) => parseEther(typeof n === "bigint" ? n.toString() : String(n));

const abi = AbiCoder.defaultAbiCoder();
const mkSalt = (tag: string) => keccak256(abi.encode(["string"], [tag]));

describe("BucketLending", () => {
  let karma: MockKarma;
  let lending: BucketLending;
  let borrower: HardhatEthersSigner;
  let stealth: HardhatEthersSigner;
  let lender1: HardhatEthersSigner;
  let lender2: HardhatEthersSigner;
  let chainId: bigint;

  const signPermit = async (
    signer: HardhatEthersSigner,
    opts: {
      stealth: string;
      bucketAmount: bigint;
      baseInterestBps: bigint | number;
      duration: bigint | number;
      deadline?: bigint | number;
      salt?: string;
    },
  ) => {
    const lendingAddr = await lending.getAddress();
    const deadline = BigInt(opts.deadline ?? Math.floor(Date.now() / 1000) + 60 * 60);
    const salt = opts.salt ?? mkSalt(`salt-${Math.random()}`);
    const domain = { name: "BucketLending", version: "1", chainId, verifyingContract: lendingAddr };
    const types = {
      BorrowPermit: [
        { name: "lending", type: "address" },
        { name: "stealth", type: "address" },
        { name: "bucketAmount", type: "uint256" },
        { name: "baseInterestBps", type: "uint256" },
        { name: "duration", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "salt", type: "bytes32" },
      ],
    } as const;
    const value = {
      lending: lendingAddr,
      stealth: opts.stealth,
      bucketAmount: opts.bucketAmount,
      baseInterestBps: BigInt(opts.baseInterestBps),
      duration: BigInt(opts.duration),
      deadline,
      salt,
    };
    const signature = await signer.signTypedData(domain, types, value);
    return { deadline, salt, signature };
  };

  beforeEach(async () => {
    const signers = await ethers.getSigners();
    borrower = signers[1];
    stealth = signers[2];
    lender1 = signers[3];
    lender2 = signers[4];

    const KarmaFactory = await ethers.getContractFactory("MockKarma");
    karma = (await KarmaFactory.deploy()) as MockKarma;

    const LendingFactory = await ethers.getContractFactory("BucketLending");
    lending = (await LendingFactory.deploy(await karma.getAddress(), BUCKETS)) as BucketLending;

    const net = await ethers.provider.getNetwork();
    chainId = net.chainId;

    // Ensure toUtf8Bytes is reachable by the type-checker; used via keccak256 in helpers.
    void toUtf8Bytes;
  });

  describe("request", () => {
    it("rejects low-karma borrowers (signer has 0 Karma)", async () => {
      const { deadline, salt, signature } = await signPermit(borrower, {
        stealth: stealth.address,
        bucketAmount: BUCKETS[0],
        baseInterestBps: 500,
        duration: 24 * 60 * 60,
      });
      await expect(
        lending
          .connect(stealth)
          .requestLoanWithPermit(stealth.address, BUCKETS[0], 500, 24 * 60 * 60, deadline, salt, signature),
      ).to.be.revertedWithCustomError(lending, "LowKarma");
    });

    it("rejects invalid buckets", async () => {
      await karma.award(borrower.address, KARMA(10));
      const { deadline, salt, signature } = await signPermit(borrower, {
        stealth: stealth.address,
        bucketAmount: parseEther("0.25"),
        baseInterestBps: 500,
        duration: 24 * 60 * 60,
      });
      await expect(
        lending
          .connect(stealth)
          .requestLoanWithPermit(stealth.address, parseEther("0.25"), 500, 24 * 60 * 60, deadline, salt, signature),
      ).to.be.revertedWithCustomError(lending, "InvalidBucket");
    });

    it("rejects amounts above the karma-derived cap", async () => {
      // 5 Karma -> cap 0.25 ETH, so 0.5 ETH bucket should fail.
      await karma.award(borrower.address, KARMA(5));
      const { deadline, salt, signature } = await signPermit(borrower, {
        stealth: stealth.address,
        bucketAmount: BUCKETS[1],
        baseInterestBps: 500,
        duration: 24 * 60 * 60,
      });
      await expect(
        lending
          .connect(stealth)
          .requestLoanWithPermit(stealth.address, BUCKETS[1], 500, 24 * 60 * 60, deadline, salt, signature),
      ).to.be.revertedWithCustomError(lending, "ExceedsBorrowLimit");
    });

    it("rejects if caller is not the stealth address", async () => {
      await karma.award(borrower.address, KARMA(10));
      const { deadline, salt, signature } = await signPermit(borrower, {
        stealth: stealth.address,
        bucketAmount: BUCKETS[0],
        baseInterestBps: 500,
        duration: 24 * 60 * 60,
      });
      await expect(
        lending
          .connect(borrower) // wrong caller
          .requestLoanWithPermit(stealth.address, BUCKETS[0], 500, 24 * 60 * 60, deadline, salt, signature),
      ).to.be.revertedWithCustomError(lending, "CallerNotStealth");
    });

    it("rejects replayed permits", async () => {
      await karma.award(borrower.address, KARMA(10));
      const { deadline, salt, signature } = await signPermit(borrower, {
        stealth: stealth.address,
        bucketAmount: BUCKETS[0],
        baseInterestBps: 500,
        duration: 24 * 60 * 60,
      });
      await lending
        .connect(stealth)
        .requestLoanWithPermit(stealth.address, BUCKETS[0], 500, 24 * 60 * 60, deadline, salt, signature);
      await expect(
        lending
          .connect(stealth)
          .requestLoanWithPermit(stealth.address, BUCKETS[0], 500, 24 * 60 * 60, deadline, salt, signature),
      ).to.be.revertedWithCustomError(lending, "PermitAlreadyUsed");
    });

    it("applies a karma-based interest discount", async () => {
      // 30 Karma -> 300 bps discount. base 500 -> 200.
      await karma.award(borrower.address, KARMA(30));
      const { deadline, salt, signature } = await signPermit(borrower, {
        stealth: stealth.address,
        bucketAmount: BUCKETS[0],
        baseInterestBps: 500,
        duration: 24 * 60 * 60,
      });
      await lending
        .connect(stealth)
        .requestLoanWithPermit(stealth.address, BUCKETS[0], 500, 24 * 60 * 60, deadline, salt, signature);
      const loan = await lending.getLoan(0);
      expect(loan.interestBps).to.equal(200n);
    });
  });

  describe("funding + repayment", () => {
    beforeEach(async () => {
      await karma.award(borrower.address, KARMA(25));
    });

    it("handles multi-lender funding, disburses to stealth, and repays pro rata", async () => {
      const { deadline, salt, signature } = await signPermit(borrower, {
        stealth: stealth.address,
        bucketAmount: BUCKETS[2],
        baseInterestBps: 500,
        duration: 24 * 60 * 60,
      });
      await lending
        .connect(stealth)
        .requestLoanWithPermit(stealth.address, BUCKETS[2], 500, 24 * 60 * 60, deadline, salt, signature);
      const loanId = 0;

      const stealthBalBefore = await ethers.provider.getBalance(stealth.address);

      await lending.connect(lender1).fundLoan(loanId, { value: parseEther("0.3") });
      let loan = await lending.getLoan(loanId);
      expect(loan.status).to.equal(0); // Open

      const l2Before = await ethers.provider.getBalance(lender2.address);
      const tx = await lending.connect(lender2).fundLoan(loanId, { value: parseEther("1") });
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;
      const l2After = await ethers.provider.getBalance(lender2.address);
      expect(l2Before - l2After - gasCost).to.equal(parseEther("0.7"));

      loan = await lending.getLoan(loanId);
      expect(loan.status).to.equal(1); // Funded
      const stealthBalAfter = await ethers.provider.getBalance(stealth.address);
      expect(stealthBalAfter - stealthBalBefore).to.equal(BUCKETS[2]);

      // 25 Karma -> 250 bps discount -> 250 bps interest.
      const owed = await lending.totalOwed(loanId);
      expect(owed).to.equal(parseEther("1.025"));

      const l1Before = await ethers.provider.getBalance(lender1.address);
      const l2BeforeRepay = await ethers.provider.getBalance(lender2.address);

      await lending.connect(stealth).repayLoan(loanId, { value: owed });

      const l1After = await ethers.provider.getBalance(lender1.address);
      const l2AfterRepay = await ethers.provider.getBalance(lender2.address);
      // L1 put 0.3 / L2 put 0.7. Pro-rata on 1.025 total -> 0.3075 / 0.7175.
      expect(l1After - l1Before).to.equal(parseEther("0.3075"));
      expect(l2AfterRepay - l2BeforeRepay).to.equal(parseEther("0.7175"));
    });

    it("cancels and refunds if the stealth borrower cancels", async () => {
      const { deadline, salt, signature } = await signPermit(borrower, {
        stealth: stealth.address,
        bucketAmount: BUCKETS[1],
        baseInterestBps: 400,
        duration: 24 * 60 * 60,
      });
      await lending
        .connect(stealth)
        .requestLoanWithPermit(stealth.address, BUCKETS[1], 400, 24 * 60 * 60, deadline, salt, signature);
      await lending.connect(lender1).fundLoan(0, { value: parseEther("0.2") });
      const before = await ethers.provider.getBalance(lender1.address);
      await lending.connect(stealth).cancelLoan(0);
      const after = await ethers.provider.getBalance(lender1.address);
      expect(after - before).to.equal(parseEther("0.2"));
    });
  });

  describe("default", () => {
    it("flags overdue loans as defaulted (no karma side-effects)", async () => {
      await karma.award(borrower.address, KARMA(20));
      const { deadline, salt, signature } = await signPermit(borrower, {
        stealth: stealth.address,
        bucketAmount: BUCKETS[0],
        baseInterestBps: 500,
        duration: 60 * 60,
      });
      await lending
        .connect(stealth)
        .requestLoanWithPermit(stealth.address, BUCKETS[0], 500, 60 * 60, deadline, salt, signature);
      await lending.connect(lender1).fundLoan(0, { value: BUCKETS[0] });

      await expect(lending.markDefault(0)).to.be.revertedWithCustomError(lending, "NotOverdue");

      await ethers.provider.send("evm_increaseTime", [60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      await lending.markDefault(0);
      const loan = await lending.getLoan(0);
      expect(loan.status).to.equal(3); // Defaulted

      // Karma is read-only: balance is untouched regardless of default.
      expect(await karma.balanceOf(borrower.address)).to.equal(KARMA(20));
    });
  });
});
