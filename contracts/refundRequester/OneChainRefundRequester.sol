// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.8;

import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import { IRefundIDO } from "./../interfaces/IRefundIDO.sol";
import { IPool } from "./../interfaces/IPool.sol";
import { BaseRefundRequester } from "./BaseRefundRequester.sol";

/**
 * @title One-chain contract for requesting refunds
 * @notice One-chain requester, gets data from IDO directly.
 */
contract OneChainRefundRequester is BaseRefundRequester {
    /**
     * @inheritdoc BaseRefundRequester
     */
    function initialize(
        address registry_,
        InitializeRefundInfo calldata refundInfo_,
        bytes calldata
    ) external override initializer {
        _baseInitialize(registry_, refundInfo_);
    }

    /**
     * @inheritdoc BaseRefundRequester
     */
    function _burnReferralShares(address identifier_, address account_) internal override {
        (address pool, IRefundIDO.Referrer[] memory referrers) = IRefundIDO(identifier_).referrersInfoOf(account_);
        IPool(pool).burnForAddresses(referrers);
    }

    /**
     * @inheritdoc BaseRefundRequester
     */
    function _isValidIdentifier(address identifier_) internal view override returns (bool) {
        return IERC165(identifier_).supportsInterface(type(IRefundIDO).interfaceId);
    }

    /**
     * @inheritdoc BaseRefundRequester
     */
    function _getPurchasedAmountInToken(
        address identifier_,
        address account_,
        bytes calldata
    ) internal view override returns (uint256) {
        return IRefundIDO(identifier_).amountOf(account_);
    }
}
