// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.8;

import "../../vesting/types/OneChainDatesRefundVesting.sol";

contract UpgradedOneChainDatesRefundVesting is OneChainDatesRefundVesting {
    function test() external pure returns (string memory) {
        return "Success";
    }
}
