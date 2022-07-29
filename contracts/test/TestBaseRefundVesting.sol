// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.8;

import { BaseRefundVesting } from "../vesting/BaseRefundVesting.sol";

contract TestBaseRefundVesting is BaseRefundVesting {
    function initialize(
        address registry_,
        InitializeInfo calldata initializeInfo_,
        bytes calldata
    ) external override initializer {
        _baseInitialize(registry_, initializeInfo_);
    }

    function addTokenInfo(InitializeInfo calldata, bytes calldata) external override {}

    function _checkIdentifier(address _identifier) internal view virtual override {}

    function _withdrawableOf(
        address,
        address,
        uint256,
        uint256
    ) internal pure override returns (uint256) {
        return 0;
    }

    function _getTotalOf(address, address) internal pure override returns (uint256) {
        return 0;
    }
}
