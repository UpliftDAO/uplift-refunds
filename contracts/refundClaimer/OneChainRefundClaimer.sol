// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.8;

import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import { IBaseRefundRequester } from "../interfaces/IBaseRefundRequester.sol";
import { IOneChainRefundClaimer } from "../interfaces/IOneChainRefundClaimer.sol";
import { BaseRefundClaimer } from "./BaseRefundClaimer.sol";

contract OneChainRefundClaimer is BaseRefundClaimer, IOneChainRefundClaimer {
    // [token][identifier]
    mapping(address => mapping(address => address)) public override refundRequesterOf;

    function initialize(
        address registry_,
        address token_,
        address identifier_,
        bytes calldata payload_
    ) external virtual override initializer {
        _baseInitialize(registry_);
        _oneChainInitialize(token_, identifier_, payload_);
    }

    function setRefundRequester(
        address token_,
        address identifier_,
        address refundRequester_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setRefundRequester(token_, identifier_, refundRequester_);
    }

    function _getRefundAmountInIDOToken(
        address token_,
        address identifier_,
        address account_,
        bytes calldata
    ) internal view override returns (uint256 amount) {
        address refundRequester = refundRequesterOf[token_][identifier_];
        IBaseRefundRequester.ReturnRefundInfo memory info = IBaseRefundRequester(refundRequester).infoOf(
            token_,
            identifier_,
            account_
        );
        amount = info.accountInfoOf.refundRequestedWithMultiplierInToken;
    }

    function _isValidForRefund(
        address token_,
        address identifier_,
        address,
        bytes calldata
    ) internal view override {
        require(refundRequesterOf[token_][identifier_] != address(0), "OCRC:Z");
    }

    function _oneChainInitialize(
        address token_,
        address identifier_,
        bytes calldata payload_
    ) private {
        address refundRequester_ = abi.decode(payload_, (address));
        _setRefundRequester(token_, identifier_, refundRequester_);
    }

    function _setRefundRequester(
        address token_,
        address identifier_,
        address refundRequester_
    ) private {
        require(IERC165(refundRequester_).supportsInterface(type(IBaseRefundRequester).interfaceId), "OCRC:I");
        refundRequesterOf[token_][identifier_] = refundRequester_;
        emit SetRefundRequester(token_, identifier_, refundRequester_);
    }
}
