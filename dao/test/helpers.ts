import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumberish } from "ethers";
import { ethers, network } from "hardhat";

const toEther = (value: string) => ethers.utils.parseEther(value);
const mineBlock = async () =>
  await network.provider.request({ method: "evm_mine" });

const restoreSnapshot = async (id: Number) => {
  await network.provider.request({ method: "evm_revert", params: [id] });
  await mineBlock();
};

const takeSnapshot = async () => {
  const result = await network.provider.request({ method: "evm_snapshot" });
  await mineBlock();
  return result;
};

const sign = async (
  signer: SignerWithAddress,
  ProposalId: BigNumberish,
  support: Boolean,
  contractAddress: string
) => {
  const domainSeparator = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["uint256", "address"],
      [31337, contractAddress]
    )
  );
  const voteHash = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["uint256", "bool"],
      [ProposalId, support]
    )
  );
  const payloadHash = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "bytes32"],
      [domainSeparator, voteHash]
    )
  );
  const signature = await signer.signMessage(
    ethers.utils.arrayify(payloadHash)
  );
  const sig = ethers.utils.splitSignature(signature);

  return sig;
};

export { toEther, takeSnapshot, restoreSnapshot, sign };
