// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.8;

import "../TestBaseRefundClaimer.sol";

contract UpgradedTestBaseRefundClaimer is TestBaseRefundClaimer {
    function test() external pure returns (string memory) {
        return "Success";
    }
}
