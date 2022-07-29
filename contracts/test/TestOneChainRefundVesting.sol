// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.8;

import { OneChainRefundVesting } from "../vesting/chains/OneChainRefundVesting.sol";

contract TestOneChainRefundVesting is OneChainRefundVesting {
    function initialize(
        address registry_,
        InitializeInfo calldata initializeInfo_,
        bytes calldata
    ) external override initializer {
        _baseInitialize(registry_, initializeInfo_);
    }

    function addTokenInfo(InitializeInfo calldata, bytes calldata) external override {}

    function _withdrawableOf(
        address,
        address,
        uint256,
        uint256
    ) internal pure override returns (uint256) {
        return 0;
    }
}
