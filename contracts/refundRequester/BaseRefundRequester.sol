// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.8;

import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import { ERC165Upgradeable } from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { IBaseRefundRequester } from "../interfaces/IBaseRefundRequester.sol";
import { IBaseRefundVesting } from "../interfaces/IBaseRefundVesting.sol";
import { BaseRoleChecker } from "../BaseRoleChecker.sol";

/**
 * @title Base contract for requesting refunds
 * @notice Base contract implements function for both one- and multi- chain refund requesters
 * Based on IDO and vesting info, contract add abitily to request refund for specific vesting
 * Unique refund identifier - [token][identifier], where:
 * token - idoToken address
 * identifier - IDO address for one-chain, zero address otherwise
 */
abstract contract BaseRefundRequester is
    IBaseRefundRequester,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable,
    ERC165Upgradeable,
    BaseRoleChecker
{
    using SafeERC20 for IERC20;

    // [token][identifier]
    mapping(address => mapping(address => RefundInfo)) private refundInfoOf;

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[50] private __gap;

    constructor() initializer {}

    /**
     * @notice Initialize function
     * @param registry_ - holds roles data. Registry smart contract
     * @param refundInfo_ - info for refund
     */
    function initialize(
        address registry_,
        InitializeRefundInfo calldata refundInfo_,
        bytes calldata
    ) external virtual;

    /**
     * @inheritdoc IBaseRefundRequester
     */
    function setRefundable(
        address token_,
        address identifier_,
        uint8 index_,
        bool isRefundable_
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        KPI[] storage KPIs = refundInfoOf[token_][identifier_].KPIs;
        require(block.timestamp < KPIs[index_].dateRequestEnd, "BRR:I");
        KPIs[index_].isRefundable = isRefundable_;
        emit SetRefundable(token_, identifier_, index_, isRefundable_);
    }

    /**
     * @inheritdoc IBaseRefundRequester
     */
    function setProjectFundsHolder(
        address token_,
        address identifier_,
        address projectFundsHolder_
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _setProjectFundsHolder(token_, identifier_, projectFundsHolder_);
    }

    /**
     * @inheritdoc IBaseRefundRequester
     */
    function setKPI(
        address token_,
        address identifier_,
        uint8 KPIIndex_,
        KPI memory KPI_
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _setKPI(token_, identifier_, KPIIndex_, KPI_, refundInfoOf[token_][identifier_].bpPrecision);
    }

    /**
     * @inheritdoc IBaseRefundRequester
     */
    function setClaimableKPI(
        address token_,
        address identifier_,
        uint8 KPIIndex_,
        bool isClaimable_
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _setClaimableKPI(token_, identifier_, KPIIndex_, isClaimable_);
    }

    /**
     * @inheritdoc IBaseRefundRequester
     */
    function requestRefund(
        address token_,
        address identifier_,
        uint256 refundInToken_,
        uint8 KPIIndex_,
        bytes calldata payload_
    ) external override nonReentrant {
        // Check if KPI is valid
        RefundInfo storage refundInfo = refundInfoOf[token_][identifier_];
        KPI storage refundKPI = refundInfo.KPIs[KPIIndex_];
        require(
            refundKPI.isRefundable &&
                block.timestamp >= refundKPI.dateRequestStart &&
                block.timestamp <= refundKPI.dateRequestEnd,
            "BRR:I"
        );

        // Get account data
        (uint256 refundAmountInToken, uint256 actualRefundAmountInToken) = _calculateRefundAmountInToken(
            token_,
            identifier_,
            msg.sender,
            refundInToken_,
            refundKPI.isFullRefund ? refundInfo.bpPrecision : refundKPI.percentInBP,
            KPIIndex_,
            payload_
        );
        require(refundAmountInToken > 0, "BRR:I");

        // Burn referral shares if it is full refund and user hasn't ask for this refund before
        if (
            refundKPI.isFullRefund && refundInfo.accountInfoOf[msg.sender].refundRequestedByKPIInToken[KPIIndex_] == 0
        ) {
            _burnReferralShares(identifier_, msg.sender);
        }

        // Update info
        _updateRequestRefundInfo(
            token_,
            identifier_,
            msg.sender,
            refundAmountInToken,
            actualRefundAmountInToken,
            refundInToken_,
            refundInfo.bpPrecision,
            refundKPI.multiplierInBP,
            KPIIndex_
        );

        emit RequestRefund(
            token_,
            identifier_,
            msg.sender,
            refundAmountInToken,
            actualRefundAmountInToken,
            refundInToken_,
            KPIIndex_
        );
    }

    /**
     * @inheritdoc IBaseRefundRequester
     */
    function infoOf(
        address token_,
        address identifier_,
        address account_
    ) external view override returns (ReturnRefundInfo memory info) {
        RefundInfo storage refundInfo = refundInfoOf[token_][identifier_];
        info.projectFundsHolder = refundInfo.projectFundsHolder;
        KPI[] storage KPIs_ = refundInfo.KPIs;
        info.KPIs = KPIs_;
        info.bpPrecision = refundInfo.bpPrecision;
        info.totalRefundRequestedByKPI = new uint256[](KPIs_.length);

        // Account info
        AccountInfo storage accountInfo = refundInfo.accountInfoOf[account_];
        info.accountInfoOf.refundRequestedInToken = accountInfo.refundRequestedInToken;
        info.accountInfoOf.claimedRefundRequestedInToken = accountInfo.claimedRefundRequestedInToken;
        info.accountInfoOf.refundRequestedByKPIInToken = new uint256[](KPIs_.length);
        info.accountInfoOf.refundRequestedWithMultiplierByKPIInToken = new uint256[](KPIs_.length);
        info.accountInfoOf.actualRefundRequestedWithMultiplierByKPIInToken = new uint256[](KPIs_.length);

        // Populate arrays
        for (uint8 i; i < KPIs_.length; ++i) {
            info.totalRefundRequestedByKPI[i] = refundInfo.totalRefundRequestedByKPI[i];
            info.accountInfoOf.refundRequestedByKPIInToken[i] = accountInfo.refundRequestedByKPIInToken[i];
            info.accountInfoOf.refundRequestedWithMultiplierByKPIInToken[i] = accountInfo
                .refundRequestedWithMultiplierByKPIInToken[i];
            info.accountInfoOf.actualRefundRequestedWithMultiplierByKPIInToken[i] = accountInfo
                .actualRefundRequestedWithMultiplierByKPIInToken[i];
        }
    }

    /**
     * @notice See {IERC165-supportsInterface}.
     */
    function supportsInterface(bytes4 interfaceId_) public view virtual override returns (bool) {
        return interfaceId_ == type(IBaseRefundRequester).interfaceId || super.supportsInterface(interfaceId_);
    }

    /**
     * @inheritdoc UUPSUpgradeable
     */
    function _authorizeUpgrade(address contract_) internal view override onlyRole(DEFAULT_ADMIN_ROLE) {
        require(IERC165(contract_).supportsInterface(type(IBaseRefundRequester).interfaceId), "BRR:I");
    }

    /**
     * @notice Common initialize function
     * @param registry_ - holds roles data. Registry smart contract
     * @param refundInfo_ - base refund info for initialization
     */
    function _baseInitialize(address registry_, InitializeRefundInfo calldata refundInfo_) internal {
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        __ERC165_init();
        __BaseRoleChecker_init(registry_);

        _setRefundInfo(refundInfo_);
    }

    /**
     * @notice Set specific refund info
     * @param refundInfo_ - base refund info for initialization
     */
    function _setRefundInfo(InitializeRefundInfo calldata refundInfo_) internal {
        require(refundInfo_.token != address(0), "BRR:Z");
        require(_isValidIdentifier(refundInfo_.identifier), "BRR:I");
        _setVesting(refundInfo_.token, refundInfo_.identifier, refundInfo_.vesting);
        _setProjectFundsHolder(refundInfo_.token, refundInfo_.identifier, refundInfo_.projectFundsHolder);
        _setBPPrecision(refundInfo_.token, refundInfo_.identifier, refundInfo_.bpPrecision);
        _setKPIs(refundInfo_.token, refundInfo_.identifier, refundInfo_.KPIs, refundInfo_.bpPrecision);
    }

    /**
     * @notice Burn parent's shares (were minted during IDO)
     * @param identifier_ - nique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @param account_ - account's address who requested for refund
     */
    function _burnReferralShares(address identifier_, address account_) internal virtual;

    /**
     * @notice Checks if identifier is valid
     * @param identifier_ - nique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @return isValid if identifier is valid
     */
    function _isValidIdentifier(address identifier_) internal view virtual returns (bool);

    /**
     * @notice Gets purchased amount in IDO tokens (for account)
     * @param identifier_ - unique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @param account_ - user's address
     * Last param - custom endcoded data (helps pass custom data depending on chain)
     * @return amount amount in IDO tokens
     */
    function _getPurchasedAmountInToken(
        address identifier_,
        address account_,
        bytes calldata
    ) internal view virtual returns (uint256);

    /**
     * @notice Set vesting contract for refund
     * @param token_ - refunded token, can't be zero address
     * @param identifier_ - unique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @param vesting_ - vesting contract (should support IBaseRefundVesting)
     */
    function _setVesting(
        address token_,
        address identifier_,
        address vesting_
    ) private {
        require(IERC165(vesting_).supportsInterface(type(IBaseRefundVesting).interfaceId), "BRR:I");
        refundInfoOf[token_][identifier_].vesting = vesting_;
        emit SetVesting(token_, identifier_, vesting_);
    }

    /**
     * @notice Set BP precision for refund
     * @param token_ - refunded token, can't be zero address
     * @param identifier_ - unique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @param bpPrecision_ - BP precision (can't be zero)
     */
    function _setBPPrecision(
        address token_,
        address identifier_,
        uint64 bpPrecision_
    ) private {
        require(bpPrecision_ > 0, "BRR:Z");
        refundInfoOf[token_][identifier_].bpPrecision = bpPrecision_;
        emit SetBPPrecision(token_, identifier_, bpPrecision_);
    }

    /**
     * @notice Set project's funds holder for refund
     * @param token_ - refunded token, can't be zero address
     * @param identifier_ - unique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @param projectFundsHolder_ - account address (can't be zero address)
     */
    function _setProjectFundsHolder(
        address token_,
        address identifier_,
        address projectFundsHolder_
    ) private {
        require(projectFundsHolder_ != address(0), "BRR:Z");
        refundInfoOf[token_][identifier_].projectFundsHolder = projectFundsHolder_;
        emit SetProjectFundsHolder(token_, identifier_, projectFundsHolder_);
    }

    /**
     * @notice Change specific KPI data
     * @param token_ - refunded token, can't be zero address
     * @param identifier_ - unique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @param KPIIndex_ - KPI's index
     * @param KPI_ - new KPI data
     * @param bpPrecision_ - bp precision for refund
     */
    function _setKPI(
        address token_,
        address identifier_,
        uint8 KPIIndex_,
        KPI memory KPI_,
        uint64 bpPrecision_
    ) private {
        KPI[] storage KPIs = refundInfoOf[token_][identifier_].KPIs;
        uint256 length = KPIs.length;
        require(block.timestamp <= KPIs[KPIIndex_].dateRequestStart, "BRR:I");
        _validateKPI(KPI_, KPIIndex_, bpPrecision_, length);
        if (KPIIndex_ > 0) {
            KPI memory prevKPI = KPIs[KPIIndex_ - 1];
            _validateKPIsSequence(KPI_, prevKPI);
        }
        if (length > 1 && KPIIndex_ < length - 1) {
            uint8 nextKPIIndex = KPIIndex_ + 1;
            KPI memory nextKPI = KPIs[nextKPIIndex];
            _validateKPIsSequence(nextKPI, KPI_);
        }

        KPIs[KPIIndex_] = KPI_;
        emit SetKPI(
            token_,
            identifier_,
            KPIIndex_,
            KPI_.dateRequestStart,
            KPI_.dateRequestEnd,
            KPI_.percentInBP,
            KPI_.multiplierInBP,
            KPI_.isFullRefund,
            KPI_.isRefundable
        );
    }

    /**
     * @notice Set KPIs for refund
     * @param token_ - refunded token, can't be zero address
     * @param identifier_ - unique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @param KPIs_ - array of KPIs
     * @param bpPrecision_ - bp precision for refund
     */
    function _setKPIs(
        address token_,
        address identifier_,
        KPI[] memory KPIs_,
        uint64 bpPrecision_
    ) private {
        uint256 length = KPIs_.length;
        require(length > 0, "BRR:Z");
        for (uint256 i; i < length; ++i) {
            KPI memory KPI_ = KPIs_[i];
            uint8 KPIIndex = uint8(i);
            _validateKPI(KPI_, KPIIndex, bpPrecision_, length);
            if (i > 0) {
                KPI memory prevKPI = KPIs_[KPIIndex - 1];
                _validateKPIsSequence(KPI_, prevKPI);
            }
            refundInfoOf[token_][identifier_].KPIs.push(KPI_);
            emit SetKPI(
                token_,
                identifier_,
                KPIIndex,
                KPI_.dateRequestStart,
                KPI_.dateRequestEnd,
                KPI_.percentInBP,
                KPI_.multiplierInBP,
                KPI_.isFullRefund,
                KPI_.isRefundable
            );
        }
    }

    /**
     * @notice Set KPI as claimable
     * @param token_ - refunded token, can't be zero address
     * @param identifier_ - unique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @param KPIIndex_ - KPI's index
     * @param isClaimable_ - is claimable KPI
     */
    function _setClaimableKPI(
        address token_,
        address identifier_,
        uint8 KPIIndex_,
        bool isClaimable_
    ) private {
        KPI storage KPI_ = refundInfoOf[token_][identifier_].KPIs[KPIIndex_];
        require(block.timestamp >= KPI_.dateRequestEnd && KPI_.isRefundable, "BRR:I");
        KPI_.isClaimable = isClaimable_;
        emit SetClaimableKPI(token_, identifier_, KPIIndex_, isClaimable_);
    }

    /**
     * @notice Update refund info after successful refund claim
     * @param token_ - refunded token, can't be zero address
     * @param identifier_ - unique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @param account_ - account address
     * @param amountToRefundInToken_ - amount of tokens that we should refund to user
     * @param actualAmountToRefundInToken_ - actual amount of tokens that we should refund to user (in case of deflationary tokens)
     * @param refundInToken_ - amount of tokens that user brings to the SC (which was already claimed)
     * @param bpPrecision_ - refund's BP precision
     * @param multiplierInBP_ - refund's multiplier
     * @param KPIIndex_ - KPI's index
     */
    function _updateRequestRefundInfo(
        address token_,
        address identifier_,
        address account_,
        uint256 amountToRefundInToken_,
        uint256 actualAmountToRefundInToken_,
        uint256 refundInToken_,
        uint64 bpPrecision_,
        uint64 multiplierInBP_,
        uint8 KPIIndex_
    ) private {
        AccountInfo storage accountInfo = refundInfoOf[token_][identifier_].accountInfoOf[account_];
        accountInfo.refundRequestedInToken += amountToRefundInToken_;
        accountInfo.claimedRefundRequestedInToken += refundInToken_;
        accountInfo.refundRequestedByKPIInToken[KPIIndex_] += amountToRefundInToken_;
        accountInfo.refundRequestedWithMultiplierByKPIInToken[KPIIndex_] +=
            (amountToRefundInToken_ * multiplierInBP_) /
            bpPrecision_;
        accountInfo.actualRefundRequestedWithMultiplierByKPIInToken[KPIIndex_] +=
            (actualAmountToRefundInToken_ * multiplierInBP_) /
            bpPrecision_;

        refundInfoOf[token_][identifier_].totalRefundRequestedByKPI[KPIIndex_] += amountToRefundInToken_;
    }

    /**
     * @notice Calculate how many tokens we should refund to account
     * @param token_ - refunded token, can't be zero address
     * @param identifier_ - unique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @param account_ - account address
     * @param refundInToken_ - amount of tokens that user brings to the SC (which was already claimed)
     * @param currentKPITotalPercentInBP_ - current KPI's total percent
     * @param currentKPIIndex_ - current KPI's index
     * @param payload_ - custom data
     * @return amountToRefundInToken amount to refund (in tokens)
     * @return actualAmountToRefundInToken - actual amount to refund (in tokens) - will be different for diflationary tokens
     */
    function _calculateRefundAmountInToken(
        address token_,
        address identifier_,
        address account_,
        uint256 refundInToken_,
        uint64 currentKPITotalPercentInBP_,
        uint8 currentKPIIndex_,
        bytes calldata payload_
    ) private returns (uint256 amountToRefundInToken, uint256 actualAmountToRefundInToken) {
        uint256 total_ = _getPurchasedAmountInToken(identifier_, msg.sender, payload_);
        require(total_ > 0, "BRR:I");
        RefundInfo storage refundInfo = refundInfoOf[token_][identifier_];
        (uint256 currentKPIPercentInBP, uint256 claimedForCurrentKPIInToken) = _currentKPIInfo(
            token_,
            identifier_,
            account_,
            total_,
            currentKPITotalPercentInBP_,
            currentKPIIndex_,
            refundInfo
        );
        uint256 refundRequestedByKPIInToken = refundInfo.accountInfoOf[account_].refundRequestedByKPIInToken[
            currentKPIIndex_
        ];

        return
            _calculateRefundAmountsInToken(
                token_,
                refundInfo.projectFundsHolder,
                refundInfo.bpPrecision,
                refundInToken_,
                claimedForCurrentKPIInToken,
                refundRequestedByKPIInToken,
                total_,
                currentKPIPercentInBP
            );
    }

    /**
     * @notice Calculate how many tokens we should refund to account
     * @param token_ - refunded token, can't be zero address
     * @param projectFundsHolder_ - account who receives all tokens
     * @param bpPrecision_ - project's BP precision
     * @param refundInToken_ - amount of tokens that user brings to the SC (which was already claimed)
     * @param claimedForCurrentKPIInToken_ - amount of tokens that user already claimed for current KPI
     * @param refundRequestedByKPIInToken_ - how many tokens user requested for refund (for specific KPI without multiplier)
     * @param total_ - total purchased amount (in tokens)
     * @param currentKPIPercentInBP_ - current KPI's percent in BP
     * @return amountToRefundInToken - amount to refund (in tokens)
     * @return actualAmountToRefundInToken - actual amount to refund (in tokens) - will be different for diflationary tokens
     */
    function _calculateRefundAmountsInToken(
        address token_,
        address projectFundsHolder_,
        uint64 bpPrecision_,
        uint256 refundInToken_,
        uint256 claimedForCurrentKPIInToken_,
        uint256 refundRequestedByKPIInToken_,
        uint256 total_,
        uint256 currentKPIPercentInBP_
    ) private returns (uint256 amountToRefundInToken, uint256 actualAmountToRefundInToken) {
        uint256 actualRefundedInToken = _handleBroughtTokens(
            token_,
            projectFundsHolder_,
            refundInToken_,
            claimedForCurrentKPIInToken_,
            refundRequestedByKPIInToken_
        );
        // Calculate refund amount
        uint256 maxRefundForKPIInToken = (total_ * currentKPIPercentInBP_) / bpPrecision_;
        // Refund only brought tokens if refund request exists
        amountToRefundInToken = refundRequestedByKPIInToken_ > 0
            ? refundInToken_
            : maxRefundForKPIInToken + refundInToken_ - claimedForCurrentKPIInToken_;
        // Will be less than amountToRefundInToken because actualRefundedInToken will be less than refundInToken_ (for deflationary token)
        actualAmountToRefundInToken = refundRequestedByKPIInToken_ > 0
            ? actualRefundedInToken
            : maxRefundForKPIInToken + actualRefundedInToken - claimedForCurrentKPIInToken_;
    }

    /**
     * @notice Get current KPI info
     * @param token_ - refunded token, can't be zero address
     * @param identifier_ - unique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @param account_ - account address
     * @param totalInToken_ - purchased amount in tokens
     * @param currentKPITotalPercentInBP_ - current KPI's total percent
     * @param currentKPIIndex_ - current KPI's index
     * @param refundInfo_ - refund info object
     */
    function _currentKPIInfo(
        address token_,
        address identifier_,
        address account_,
        uint256 totalInToken_,
        uint64 currentKPITotalPercentInBP_,
        uint8 currentKPIIndex_,
        RefundInfo storage refundInfo_
    ) private view returns (uint256 currentKPIPercentInBP, uint256 claimedForCurrentKPIInToken) {
        // Get total percent for all previous KPIs and for current KPI
        uint256 prevKPIsTotalInToken;
        currentKPIPercentInBP = currentKPITotalPercentInBP_;
        if (currentKPIIndex_ > 0) {
            uint64 prevKPIPercentInBP = refundInfo_.KPIs[currentKPIIndex_ - 1].percentInBP;
            currentKPIPercentInBP -= prevKPIPercentInBP;
            prevKPIsTotalInToken = (totalInToken_ * prevKPIPercentInBP) / refundInfo_.bpPrecision;
        }

        // Check claimed tokens
        uint256 totalClaimedInToken = IBaseRefundVesting(refundInfo_.vesting).claimed(token_, identifier_, account_);
        uint256 total = totalClaimedInToken +
            refundInfo_.accountInfoOf[account_].refundRequestedInToken -
            refundInfo_.accountInfoOf[account_].claimedRefundRequestedInToken;
        if (total > prevKPIsTotalInToken) {
            claimedForCurrentKPIInToken = total - prevKPIsTotalInToken;
        }
    }

    /**
     * @notice Transfer tokens, if user bring some
     * @param token_ - refunded token, can't be zero address
     * @param projectFundsHolder_ - account who gets all tokens
     * @param refundInToken_ - amount of tokens that user brings to the SC (which was already claimed)
     * @param claimedForCurrentKPIInToken_ - amount of tokens that user already claimed for current KPI
     * @param refundedForCurrentKPI_ - amount of tokens that was already refunded for current KPI
     * @return actualRefundedInToken - actual amount that user bring to the SC (can be different for deflationary tokens)
     */
    function _handleBroughtTokens(
        address token_,
        address projectFundsHolder_,
        uint256 refundInToken_,
        uint256 claimedForCurrentKPIInToken_,
        uint256 refundedForCurrentKPI_
    ) private returns (uint256 actualRefundedInToken) {
        if (refundInToken_ == 0) {
            return 0;
        }
        require(refundInToken_ <= claimedForCurrentKPIInToken_ - refundedForCurrentKPI_, "BRR:I");
        uint256 balance = IERC20(token_).balanceOf(projectFundsHolder_);
        IERC20(token_).safeTransferFrom(msg.sender, projectFundsHolder_, refundInToken_);
        uint256 newBalance = IERC20(token_).balanceOf(projectFundsHolder_);
        if (newBalance > balance) {
            actualRefundedInToken = newBalance - balance;
        }
    }

    /**
     * @notice Validate KPI data
     * @param KPI_ - KPI to validate
     * @param KPIIndex_ - KPI's index
     * @param bpPrecision_ - project's BP precision
     * @param length_ - KPIs length
     */
    function _validateKPI(
        KPI memory KPI_,
        uint8 KPIIndex_,
        uint64 bpPrecision_,
        uint256 length_
    ) private pure {
        require(KPI_.dateRequestEnd > KPI_.dateRequestStart, "BRR:I");
        if (KPIIndex_ == length_ - 1) {
            require(KPI_.percentInBP == bpPrecision_, "BRR:I");
        }
    }

    /**
     * @notice Validate KPI sequence
     * @param KPI_ - current KPI to validate
     * @param prevKPI_ - previous KPI to validate
     */
    function _validateKPIsSequence(KPI memory KPI_, KPI memory prevKPI_) private pure {
        require(KPI_.dateRequestStart >= prevKPI_.dateRequestEnd, "BRR:I");
        require(KPI_.percentInBP > prevKPI_.percentInBP, "BRR:I");
    }
}
