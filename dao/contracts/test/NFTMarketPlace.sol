//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface INFTMarketPlace {
    function buy(address nftContract, uint256 nftId)
        external
        payable
        returns (bool success);
}

contract NFTMarketPlace is INFTMarketPlace {
    uint256 public entered = 1;

    function buy(address nftContract, uint256 nftId)
        external
        payable
        override
        returns (bool success)
    {
        entered = 2;
        return true;
    }
}
