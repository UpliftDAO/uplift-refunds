// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.8;

import { BaseRefundClaimer } from "../refundClaimer/BaseRefundClaimer.sol";

contract TestBaseRefundClaimer is BaseRefundClaimer {
    function initialize(
        address registry_,
        address,
        address,
        bytes calldata
    ) external override initializer {
        _baseInitialize(registry_);
    }

    function _isValidForRefund(
        address,
        address,
        address,
        bytes calldata
    ) internal view override returns (bool) {}

    function _getRefundAmountInIDOToken(
        address,
        address,
        address,
        bytes calldata
    ) internal view override returns (uint256) {}
}
