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
    // [IDOToken][identifier]
    mapping(address => mapping(address => address)) public override refundRequesterOf;

    /**
     * @inheritdoc BaseRefundClaimer
     */
    function initialize(
        address registry_,
        address IDOToken_,
        address identifier_,
        bytes calldata payload_
    ) external virtual override initializer {
        _baseInitialize(registry_);
        _oneChainInitialize(IDOToken_, identifier_, payload_);
    }

    /**
     * @inheritdoc BaseRefundClaimer
     */
    function addRefundClaim(
        address IDOToken_,
        address identifier_,
        bytes calldata payload_
    ) external virtual override onlyRole(DEFAULT_ADMIN_ROLE) {
        _oneChainInitialize(IDOToken_, identifier_, payload_);
    }

    /**
     * @inheritdoc IOneChainRefundClaimer
     */
    function setRefundRequester(
        address IDOToken_,
        address identifier_,
        address refundRequester_
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _setRefundRequester(IDOToken_, identifier_, refundRequester_);
    }

    /**
     * @inheritdoc BaseRefundClaimer
     */
    function _isValidForRefund(
        address IDOToken_,
        address identifier_,
        address,
        uint8[] calldata,
        bytes calldata
    ) internal view override returns (bool) {
        return refundRequesterOf[IDOToken_][identifier_] != address(0);
    }

    /**
     * @inheritdoc BaseRefundClaimer
     */
    function _getRefundAmountsInIDOToken(
        address IDOToken_,
        address identifier_,
        address account_,
        uint8[] calldata KPIIndices_,
        bytes calldata
    ) internal view override returns (uint256 amountTotalInIDOToken, uint256[] memory amountsByKPIInIDOToken) {
        IBaseRefundRequester.ReturnRefundInfo memory info = IBaseRefundRequester(
            refundRequesterOf[IDOToken_][identifier_]
        ).infoOf(IDOToken_, identifier_, account_);
        uint256 length = KPIIndices_.length;
        amountsByKPIInIDOToken = new uint256[](length);
        for (uint256 i; i < length; ++i) {
            uint8 KPIIndex = KPIIndices_[i];
            uint256 amountByKPIInIDOToken = _getRefundAmountByKPIInIDOToken(
                IDOToken_,
                identifier_,
                account_,
                KPIIndex,
                info.accountInfoOf.actualRefundRequestedWithMultiplierByKPIInToken[KPIIndex],
                info.KPIs[KPIIndex].isClaimable
            );
            if (amountByKPIInIDOToken > 0) {
                amountsByKPIInIDOToken[i] = amountByKPIInIDOToken;
                amountTotalInIDOToken += amountByKPIInIDOToken;
            }
        }
    }

    /**
     * @notice Initialize function for one-chain claimer
     * @param IDOToken_ - distribution token (which user bought in the IDO)
     * @param identifier_ - unique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @param payload_ - custom data (for one chain holds decoded refundRequester)
     */
    function _oneChainInitialize(
        address IDOToken_,
        address identifier_,
        bytes calldata payload_
    ) private {
        _checkIdentifier(identifier_);
        address refundRequester_ = abi.decode(payload_, (address));
        _setRefundRequester(IDOToken_, identifier_, refundRequester_);
    }

    /**
     * @notice Set refund requester address (OneChainRefundRequester contract)
     * @param IDOToken_ - distribution token (which user bought in the IDO)
     * @param identifier_ - unique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @param refundRequester_ - new refund requester address (OneChainRefundRequester contract)
     */
    function _setRefundRequester(
        address IDOToken_,
        address identifier_,
        address refundRequester_
    ) private {
        require(IERC165(refundRequester_).supportsInterface(type(IBaseRefundRequester).interfaceId), "OCRC:I");
        refundRequesterOf[IDOToken_][identifier_] = refundRequester_;
        emit SetRefundRequester(IDOToken_, identifier_, refundRequester_);
    }

    /**
     * @notice Gets refund amount for one KPI in IDO tokens
     * @param IDOToken_ - distribution token (which user bought in the IDO)
     * @param identifier_ - unique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @param account_ - user's address
     * @param KPIIndex_ - KPI Index
     * @param refundRequestedWithMultiplierInIDOToken_ - amount with multiplier requested by user in IDO token
     * @param isClaimable_ - is claimable KPI
     * @return amountByKPIInIDOToken amount by KPI in IDO tokens
     */
    function _getRefundAmountByKPIInIDOToken(
        address IDOToken_,
        address identifier_,
        address account_,
        uint8 KPIIndex_,
        uint256 refundRequestedWithMultiplierInIDOToken_,
        bool isClaimable_
    ) private view returns (uint256 amountByKPIInIDOToken) {
        uint256 refundClaimedByKPIInIDOToken = refundClaimedByKPIInIDOToken[IDOToken_][identifier_][account_][
            KPIIndex_
        ];
        if (isClaimable_ && refundRequestedWithMultiplierInIDOToken_ > refundClaimedByKPIInIDOToken) {
            amountByKPIInIDOToken = refundRequestedWithMultiplierInIDOToken_ - refundClaimedByKPIInIDOToken;
        }
    }
}
