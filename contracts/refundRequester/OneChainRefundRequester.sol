// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.8;

import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import { IRefundIDO } from "./../interfaces/IRefundIDO.sol";
import { IPool } from "./../interfaces/IPool.sol";
import { BaseRefundRequester } from "./BaseRefundRequester.sol";

contract OneChainRefundRequester is BaseRefundRequester {
    function initialize(
        address registry_,
        InitializeRefundInfo calldata refundInfo_,
        bytes calldata
    ) external override initializer {
        _baseInitialize(registry_, refundInfo_);
    }

    function _burnReferralShares(address identifier_, address account_) internal override {
        (address pool, IRefundIDO.Referrer[] memory referrers) = IRefundIDO(identifier_).referrersInfoOf(account_);
        IPool(pool).burnForAddresses(referrers);
    }

    function _checkIdentifier(address identifier_) internal view override {
        require(IERC165(identifier_).supportsInterface(type(IRefundIDO).interfaceId), "OCRR:I");
    }

    function _getAmountOf(address identifier_, address account_) internal view override returns (uint256) {
        return IRefundIDO(identifier_).amountOf(account_);
    }
}
