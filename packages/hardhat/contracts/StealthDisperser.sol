// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title StealthDisperser
/// @notice Minimal permissionless helper used by the BucketLending UI to top up
///         many stealth addresses in a single transaction.
///
/// Why this exists:
///   - When Status Network does not grant a stealth the gasless tier (no Karma),
///     the stealth needs a small ETH top-up to submit its loan permit. Doing
///     one `main -> stealth` transfer per loan trivially tags each stealth with
///     the Karma holder's main wallet and leaks the bucket size via the top-up
///     amount.
///   - Funneling all top-ups through a single `batch(...)` call at least:
///       * hides which recipient corresponds to which loan (observers see a
///         set of recipients, not per-recipient intent),
///       * lets the UI include decoy recipients to dilute correlation,
///       * normalizes the per-recipient amount so the top-up no longer
///         telegraphs the specific tx cost it is about to pay for.
///
/// Security notes:
///   - Stateless and permissionless — anyone can call.
///   - Reverts if totals don't match msg.value, so no dust can get stuck.
///   - Reverts if any transfer fails; the whole batch is atomic.
///   - No fallback / no storage — gas profile is exactly transfers + arith.
contract StealthDisperser {
    error LengthMismatch();
    error TotalMismatch(uint256 expected, uint256 provided);
    error TransferFailed(address to);

    /// @notice Emitted once per batch, useful for indexers to recognize
    ///         disperser-originated sends without re-parsing calldata.
    event Dispersed(address indexed sender, uint256 recipients, uint256 total);

    /// @notice Send `amounts[i]` ETH to `recipients[i]` for all i, in one tx.
    ///         `msg.value` must equal `sum(amounts)` exactly.
    function batch(address[] calldata recipients, uint256[] calldata amounts) external payable {
        uint256 len = recipients.length;
        if (len != amounts.length) revert LengthMismatch();

        uint256 total;
        for (uint256 i = 0; i < len; ++i) {
            total += amounts[i];
        }
        if (total != msg.value) revert TotalMismatch(total, msg.value);

        for (uint256 i = 0; i < len; ++i) {
            (bool ok, ) = payable(recipients[i]).call{ value: amounts[i] }("");
            if (!ok) revert TransferFailed(recipients[i]);
        }

        emit Dispersed(msg.sender, len, total);
    }
}
