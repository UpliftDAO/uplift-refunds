// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.8;

import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import { IBaseRefundRequester } from "../interfaces/IBaseRefundRequester.sol";
import { IOneChainRefundClaimer } from "../interfaces/IOneChainRefundClaimer.sol";
import { BaseRefundClaimer } from "./BaseRefundClaimer.sol";

/**
 * @title One-chain contract for claiming refunds
 * @notice One-chain claimer, gets data from refund requester directly.
 */
contract OneChainRefundClaimer is BaseRefundClaimer, IOneChainRefundClaimer {
    // [token][identifier]
    mapping(address => mapping(address => OneChainRefundInfo)) public override requesterInfoOf;

    /**
     * @inheritdoc BaseRefundClaimer
     */
    function initialize(
        address registry_,
        address token_,
        address identifier_,
        bytes calldata payload_
    ) external virtual override initializer {
        _baseInitialize(registry_);
        _oneChainInitialize(token_, identifier_, payload_);
    }

    /**
     * @inheritdoc IOneChainRefundClaimer
     */
    function setRefundRequester(
        address token_,
        address identifier_,
        address refundRequester_
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _setRefundRequester(token_, identifier_, refundRequester_);
    }

    /**
     * @inheritdoc IOneChainRefundClaimer
     */
    function setIDOToken(
        address token_,
        address identifier_,
        address IDOToken_
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _setIDOToken(token_, identifier_, IDOToken_);
    }

    /**
     * @inheritdoc BaseRefundClaimer
     */
    function _getRefundAmountInIDOToken(
        address token_,
        address identifier_,
        address account_,
        bytes calldata
    ) internal view override returns (uint256 amount) {
        OneChainRefundInfo memory requesterInfo = requesterInfoOf[token_][identifier_];
        IBaseRefundRequester.ReturnRefundInfo memory info = IBaseRefundRequester(requesterInfo.refundRequester).infoOf(
            requesterInfo.IDOToken,
            identifier_,
            account_
        );
        amount = info.accountInfoOf.refundRequestedWithMultiplierInToken;
    }

    /**
     * @inheritdoc BaseRefundClaimer
     */
    function _isValidForRefund(
        address token_,
        address identifier_,
        address,
        bytes calldata
    ) internal view override returns (bool) {
        return requesterInfoOf[token_][identifier_].refundRequester != address(0);
    }

    /**
     * @notice Initialize function for one-chain claimer
     * @param token_ - buy token, can't be zero address
     * @param identifier_ - unique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @param payload_ - custom data (for one chain holds decoded (refundRequester and IDOToken))
     */
    function _oneChainInitialize(
        address token_,
        address identifier_,
        bytes calldata payload_
    ) private {
        (address refundRequester_, address IDOToken_) = abi.decode(payload_, (address, address));
        _setRefundRequester(token_, identifier_, refundRequester_);
        _setIDOToken(token_, identifier_, IDOToken_);
    }

    /**
     * @notice Set refund requester address (OneChainRefundRequester contract)
     * @param token_ - buy token, can't be zero address
     * @param identifier_ - unique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @param refundRequester_ - new refund requester address (OneChainRefundRequester contract)
     */
    function _setRefundRequester(
        address token_,
        address identifier_,
        address refundRequester_
    ) private {
        require(IERC165(refundRequester_).supportsInterface(type(IBaseRefundRequester).interfaceId), "OCRC:I");
        requesterInfoOf[token_][identifier_].refundRequester = refundRequester_;
        emit SetRefundRequester(token_, identifier_, refundRequester_);
    }

    /**
     * @notice Set IDO token address
     * @param token_ - buy token, can't be zero address
     * @param identifier_ - unique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @param IDOToken_ - new IDO token address
     */
    function _setIDOToken(
        address token_,
        address identifier_,
        address IDOToken_
    ) private {
        requesterInfoOf[token_][identifier_].IDOToken = IDOToken_;
        emit SetIDOToken(token_, identifier_, IDOToken_);
    }
}
