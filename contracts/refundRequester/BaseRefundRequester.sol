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

    function initialize(
        address registry_,
        InitializeRefundInfo calldata refundInfo_,
        bytes calldata
    ) external virtual;

    function setRefundable(
        address token_,
        address identifier_,
        uint8 index_,
        bool isRefundable_
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        KPI[] storage KPIs = refundInfoOf[token_][identifier_].KPIs;
        require(block.timestamp < KPIs[index_].dateRequestEnd, "BRR:I");
        KPIs[index_].refundable = isRefundable_;
        emit SetRefundable(token_, identifier_, index_, isRefundable_);
    }

    function setProjectFundsHolder(
        address token_,
        address identifier_,
        address projectFundsHolder_
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _setProjectFundsHolder(token_, identifier_, projectFundsHolder_);
    }

    function setKPI(
        address token_,
        address identifier_,
        uint8 KPIIndex_,
        KPI memory KPI_
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _setKPI(token_, identifier_, KPIIndex_, KPI_, refundInfoOf[token_][identifier_].bpPrecision);
    }

    function requestRefund(
        address token_,
        address identifier_,
        uint256 refundInToken_, // 0 if only unvested refund
        uint8 KPIIndex_,
        bytes calldata
    ) external override nonReentrant {
        // Check if KPI is valid
        RefundInfo storage refundInfo = refundInfoOf[token_][identifier_];
        KPI storage refundKPI = refundInfo.KPIs[KPIIndex_];
        require(
            refundKPI.refundable &&
                block.timestamp >= refundKPI.dateRequestStart &&
                block.timestamp <= refundKPI.dateRequestEnd,
            "BRR:I"
        );

        // Get account data
        uint64 percentInBP = refundKPI.isFullRefund ? refundInfo.bpPrecision : refundKPI.percentInBP;
        uint256 refundAmountInToken = _calculateRefundAmountInToken(
            token_,
            identifier_,
            msg.sender,
            refundInToken_,
            percentInBP,
            KPIIndex_
        );
        require(refundAmountInToken > 0, "BRR:I");

        // Burn referral shares if it is full refund and user hasn't ask for this refund before
        if (
            refundKPI.isFullRefund && refundInfo.accountInfoOf[msg.sender].refundRequestedByKPIInToken[KPIIndex_] == 0
        ) {
            _burnReferralShares(identifier_, msg.sender);
        }

        // Update info
        _updateRequestRefundInfoForAccount(
            token_,
            identifier_,
            msg.sender,
            refundAmountInToken,
            refundInToken_,
            refundInfo.bpPrecision,
            refundKPI.multiplierInBP,
            KPIIndex_
        );

        emit RequestRefund(token_, identifier_, msg.sender, refundAmountInToken, refundInToken_, KPIIndex_);
    }

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
        info.accountInfoOf.refundRequestedWithMultiplierInToken = accountInfo.refundRequestedWithMultiplierInToken;
        info.accountInfoOf.claimedRefundRequestedInToken = accountInfo.claimedRefundRequestedInToken;
        info.accountInfoOf.refundRequestedByKPIInToken = new uint256[](KPIs_.length);

        // Populate arrays
        for (uint8 i; i < KPIs_.length; ++i) {
            info.totalRefundRequestedByKPI[i] = refundInfo.totalRefundRequestedByKPI[i];
            info.accountInfoOf.refundRequestedByKPIInToken[i] = accountInfo.refundRequestedByKPIInToken[i];
        }
    }

    function supportsInterface(bytes4 interfaceId_) public view virtual override returns (bool) {
        return interfaceId_ == type(IBaseRefundRequester).interfaceId || super.supportsInterface(interfaceId_);
    }

    /**
     * @inheritdoc UUPSUpgradeable
     */
    function _authorizeUpgrade(address contract_) internal view override onlyRole(DEFAULT_ADMIN_ROLE) {
        require(IERC165(contract_).supportsInterface(type(IBaseRefundRequester).interfaceId), "BRR:I");
    }

    function _baseInitialize(address registry_, InitializeRefundInfo calldata refundInfo_) internal {
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        __ERC165_init();
        __BaseRoleChecker_init(registry_);

        _setRefundInfo(refundInfo_);
    }

    function _setRefundInfo(InitializeRefundInfo calldata refundInfo_) internal {
        require(refundInfo_.token != address(0), "BRR:Z");
        _checkIdentifier(refundInfo_.identifier);
        _setVesting(refundInfo_.token, refundInfo_.identifier, refundInfo_.vesting);
        _setProjectFundsHolder(refundInfo_.token, refundInfo_.identifier, refundInfo_.projectFundsHolder);
        _setBPPrecision(refundInfo_.token, refundInfo_.identifier, refundInfo_.bpPrecision);
        _setKPIs(refundInfo_.token, refundInfo_.identifier, refundInfo_.KPIs, refundInfo_.bpPrecision);
    }

    function _burnReferralShares(address identifier_, address account_) internal virtual;

    function _checkIdentifier(address identifier_) internal view virtual;

    function _getAmountOf(address identifier_, address account_) internal view virtual returns (uint256);

    function _setVesting(
        address token_,
        address identifier_,
        address vesting_
    ) private {
        require(IERC165(vesting_).supportsInterface(type(IBaseRefundVesting).interfaceId), "BRR:I");
        refundInfoOf[token_][identifier_].vesting = vesting_;
        emit SetVesting(token_, identifier_, vesting_);
    }

    function _setBPPrecision(
        address token_,
        address identifier_,
        uint64 bpPrecision_
    ) private {
        require(bpPrecision_ > 0, "BRR:Z");
        refundInfoOf[token_][identifier_].bpPrecision = bpPrecision_;
        emit SetBPPrecision(token_, identifier_, bpPrecision_);
    }

    function _setProjectFundsHolder(
        address token_,
        address identifier_,
        address projectFundsHolder_
    ) private {
        require(projectFundsHolder_ != address(0), "BRR:Z");
        refundInfoOf[token_][identifier_].projectFundsHolder = projectFundsHolder_;
        emit SetProjectFundsHolder(token_, identifier_, projectFundsHolder_);
    }

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
            KPI_.refundable
        );
    }

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
                KPI_.refundable
            );
        }
    }

    function _updateRequestRefundInfoForAccount(
        address token_,
        address identifier_,
        address account_,
        uint256 amountToRefundInToken_,
        uint256 refundInToken_,
        uint64 bpPrecision_,
        uint64 multiplierInBP_,
        uint8 KPIIndex_
    ) private {
        AccountInfo storage accountInfo = refundInfoOf[token_][identifier_].accountInfoOf[account_];
        accountInfo.refundRequestedInToken += amountToRefundInToken_;
        accountInfo.refundRequestedWithMultiplierInToken += (amountToRefundInToken_ * multiplierInBP_) / bpPrecision_;
        accountInfo.claimedRefundRequestedInToken += refundInToken_;
        accountInfo.refundRequestedByKPIInToken[KPIIndex_] += amountToRefundInToken_;
    }

    function _calculateRefundAmountInToken(
        address token_,
        address identifier_,
        address account_,
        uint256 refundInToken_,
        uint64 currentKPITotalPercentInBP_,
        uint8 currentKPIIndex_
    ) private returns (uint256 amountToRefundInToken) {
        uint256 total_ = _getAmountOf(identifier_, msg.sender);
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
        _handleBroughtTokens(
            token_,
            refundInfo.projectFundsHolder,
            refundInToken_,
            claimedForCurrentKPIInToken,
            refundRequestedByKPIInToken
        );

        // Calculate refund amount
        uint256 maxRefundForKPIInToken = (total_ * currentKPIPercentInBP) / refundInfo.bpPrecision;
        // Refund only brought tokens if refund request exists
        amountToRefundInToken = refundRequestedByKPIInToken > 0
            ? refundInToken_
            : maxRefundForKPIInToken + refundInToken_ - claimedForCurrentKPIInToken;
    }

    function _currentKPIInfo(
        address token_,
        address identifier_,
        address account_,
        uint256 total_,
        uint64 currentKPITotalPercentInBP_,
        uint8 currentKPIIndex_,
        RefundInfo storage refundInfo
    ) private view returns (uint256 currentKPIPercentInBP, uint256 claimedForCurrentKPIInToken) {
        // Get total percent for all previous KPIs and for current KPI
        uint256 prevKPIsTotalInToken;
        currentKPIPercentInBP = currentKPITotalPercentInBP_;
        if (currentKPIIndex_ > 0) {
            uint64 prevKPIPercentInBP = refundInfo.KPIs[currentKPIIndex_ - 1].percentInBP;
            currentKPIPercentInBP -= prevKPIPercentInBP;
            prevKPIsTotalInToken = (total_ * prevKPIPercentInBP) / refundInfo.bpPrecision;
        }

        // Check claimed tokens
        uint256 totalClaimedInToken = IBaseRefundVesting(refundInfo.vesting).claimed(token_, identifier_, account_);
        uint256 total = totalClaimedInToken +
            refundInfo.accountInfoOf[account_].refundRequestedInToken -
            refundInfo.accountInfoOf[account_].claimedRefundRequestedInToken;
        if (total > prevKPIsTotalInToken) {
            claimedForCurrentKPIInToken = total - prevKPIsTotalInToken;
        }
    }

    function _handleBroughtTokens(
        address token_,
        address projectFundsHolder_,
        uint256 refundInToken_,
        uint256 claimedForCurrentKPIInToken_,
        uint256 refundedForCurrentKPI_
    ) private {
        if (refundInToken_ == 0) {
            return;
        }
        require(refundInToken_ <= claimedForCurrentKPIInToken_ - refundedForCurrentKPI_, "BRR:I");
        IERC20(token_).safeTransferFrom(msg.sender, projectFundsHolder_, refundInToken_);
    }

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

    function _validateKPIsSequence(KPI memory KPI_, KPI memory prevKPI_) private pure {
        require(KPI_.dateRequestStart >= prevKPI_.dateRequestEnd, "BRR:I");
        require(KPI_.percentInBP > prevKPI_.percentInBP, "BRR:I");
    }
}
