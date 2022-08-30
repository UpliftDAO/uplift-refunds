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

    function addRefundClaim(
        address,
        address,
        bytes calldata
    ) external virtual override {}

    function _isValidForRefund(
        address,
        address,
        address,
        uint8[] calldata,
        bytes calldata
    ) internal view override returns (bool) {}

    function _getRefundAmountsInIDOToken(
        address,
        address,
        address,
        uint8[] calldata,
        bytes calldata
    ) internal view override returns (uint256, uint256[] memory) {}
}
