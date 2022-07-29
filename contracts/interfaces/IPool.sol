// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.8;

import { IReferrer } from "./IReferrer.sol";

interface IPool is IReferrer {
    function sharesOf(address account_) external view returns (uint256);

    function token() external view returns (address);

    function totalSupply() external view returns (uint256);

    function mint(address account_, uint256 amount_) external;

    function mintForAddresses(Referrer[] calldata referrers_) external;

    function burn(address account_, uint256 amount_) external;

    function burnForAddresses(Referrer[] calldata referrers_) external;

    function withdraw() external returns (uint256);

    function withdrawForAccount(address from_, address to_) external returns (uint256);

    function balanceOf(address account_) external view returns (uint256);

    event Mint(address indexed account, uint256 amount);
    event Burn(address indexed account, uint256 amount);
    event Withdraw(address indexed sender, address indexed recipient, uint256 tokenReward);
}
