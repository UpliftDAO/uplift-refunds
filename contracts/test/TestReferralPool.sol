// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.8;

import { IPool } from "../interfaces/IPool.sol";

contract TestReferralPool is IPool {
    address public override token;
    uint256 public override totalSupply;

    mapping(address => uint256) public override balanceOf;
    mapping(address => uint256) public override sharesOf;

    function mint(address account_, uint256 amount_) external override {
        sharesOf[account_] += amount_;
    }

    function mintForAddresses(Referrer[] calldata) external override {}

    function burn(address, uint256) external override {}

    function burnForAddresses(Referrer[] calldata _referrers) external override {
        for (uint256 i; i < _referrers.length; ++i) {
            sharesOf[_referrers[i].account] -= _referrers[i].amount;
        }
    }

    function withdraw() external pure override returns (uint256) {
        return 0;
    }

    function withdrawForAccount(address, address) external pure override returns (uint256) {
        return 0;
    }
}
