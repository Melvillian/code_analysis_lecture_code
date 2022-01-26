import { expect } from "chai";
import { ethers, network } from "hardhat";
import { toEther, sign } from "./helpers";
import { CollectorDao, NFTMarketPlace } from "../typechain/";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumberish } from "ethers";

describe("CollectorDao", function () {
  let collectorDao: CollectorDao;
  let nftMarketPlace: NFTMarketPlace;
  let signers: SignerWithAddress[];
  let NFTMarketPlaceAddress: string;
  let ProposalId: BigNumberish;

  before(async function () {
    const CollectorDaoFactory = await ethers.getContractFactory("CollectorDao");
    collectorDao = await CollectorDaoFactory.deploy();
    await collectorDao.deployed();

    nftMarketPlace = await (
      await ethers.getContractFactory("NFTMarketPlace")
    ).deploy();
    await nftMarketPlace.deployed();

    NFTMarketPlaceAddress = nftMarketPlace.address;
    signers = await ethers.getSigners();
  });

  /* ///////////////////////////////////////////////////////////////
                      MEMEBERSHIP
    ////////////////////////////////////////////////////////////// */

  it("Allows anyone to buy a membership for 1 ETH", async function () {
    // Initial state
    expect(await collectorDao.members(signers[0].address)).to.eq(false);
    expect(await collectorDao.totalMembers()).to.eq(0);

    // Wrong contributions
    expect(collectorDao.joinDao({ value: toEther("0.99") })).revertedWith(
      "IncorrectContribution()"
    );
    expect(collectorDao.joinDao({ value: toEther("1.01") })).revertedWith(
      "IncorrectContribution()"
    );

    // Correct
    await collectorDao.joinDao({ value: toEther("1") });
    await collectorDao.connect(signers[1]).joinDao({ value: toEther("1") });
    await collectorDao.connect(signers[2]).joinDao({ value: toEther("1") });
    await collectorDao.connect(signers[3]).joinDao({ value: toEther("1") });

    // Final State
    expect(await collectorDao.totalMembers()).to.eq(4);
    expect(await collectorDao.members(signers[0].address)).to.eq(true);

    // Wrong contributions
    expect(collectorDao.joinDao({ value: toEther("1") })).revertedWith(
      "AlreadyMember()"
    );
  });

  /* ///////////////////////////////////////////////////////////////
                      PROPOSAL
    ////////////////////////////////////////////////////////////// */

  it("Allows members only to create Proposal", async function () {
    const targets = [NFTMarketPlaceAddress];
    const values = [toEther("2")];
    // Function Selector : 0x591064bb
    // Parameters:
    // [0] 000000000000000000000000b6001598781747c2b3b8dd889991911524b95c8f
    // [1] 0000000000000000000000000000000000000000000000000000000000000001
    const calldata = [
      "0xcce7ec13000000000000000000000000b6001598781747c2b3b8dd889991911524b95c8f0000000000000000000000000000000000000000000000000000000000000001",
    ];

    await collectorDao.propose(targets, values, calldata);

    ProposalId = await collectorDao.hashProposal(targets, values, calldata);

    const proposal = await collectorDao.proposals(ProposalId);
    // console.log(proposal);

    const currentBlockNumber = Number(
      await network.provider.send("eth_blockNumber")
    );
    expect(proposal.proposer).eq(signers[0].address);
    expect(proposal.startBlock).eq(currentBlockNumber + 10);
    expect(proposal.endBlock).eq(currentBlockNumber + 10 + 100);
    expect(proposal.executed).eq(false);
    expect(proposal.canceled).eq(false);

    expect(
      collectorDao.connect(signers[5]).propose(targets, values, calldata)
    ).revertedWith("NotAMember");
  });

  it("Proposal Validation", async function () {
    const targets = [NFTMarketPlaceAddress];
    const values = [toEther("2")];
    const calldata = [
      "0xcce7ec13000000000000000000000000b6001598781747c2b3b8dd889991911524b95c8f0000000000000000000000000000000000000000000000000000000000000001",
    ];

    expect(collectorDao.propose(targets, values, calldata)).revertedWith(
      'InvalidProposal("duplicate")'
    );
    expect(collectorDao.propose(targets, [], calldata)).revertedWith(
      'InvalidProposal("targets!=values")'
    );
    expect(collectorDao.propose(targets, values, [])).revertedWith(
      'InvalidProposal("targets!=calldatas")'
    );
    expect(collectorDao.propose([], [], [])).revertedWith(
      'InvalidProposal("empty")'
    );
  });

  it("Proposal Cancellation", async function () {
    await collectorDao.propose(
      [NFTMarketPlaceAddress],
      [toEther("1")],
      ["0xcce7ec13"]
    );
    const proposalId = await collectorDao.hashProposal(
      [NFTMarketPlaceAddress],
      [toEther("1")],
      ["0xcce7ec13"]
    );
    expect(collectorDao.connect(signers[1]).cancel(proposalId)).revertedWith(
      "NotAProposer()"
    );
    await collectorDao.cancel(proposalId);

    expect(await collectorDao.state(proposalId)).to.be.eq(1);

    expect(collectorDao.cancel(proposalId)).revertedWith(
      "ProposalAlreadyCanceled()"
    );
  });

  /* ///////////////////////////////////////////////////////////////
                      VOTING
    ////////////////////////////////////////////////////////////// */

  it("Proposal Voting", async function () {
    // Pending state
    expect(collectorDao.castVote(ProposalId, true)).revertedWith(
      "VotingClosed()"
    );
    expect(await collectorDao.state(ProposalId)).to.eq(2);

    expect(collectorDao.castVote(111, true)).revertedWith(
      'InvalidProposal("NotDefined")'
    );

    while ((await collectorDao.state(ProposalId)) !== 3)
      await network.provider.send("evm_mine");

    expect(await collectorDao.state(ProposalId)).to.eq(3);

    // Active state
    // CastVote
    await collectorDao.castVote(ProposalId, true);

    expect(
      collectorDao.connect(signers[5]).castVote(ProposalId, true)
    ).revertedWith("NotAMember()");
    expect(collectorDao.castVote(ProposalId, true)).revertedWith(
      "AlreadyVoted()"
    );
    expect((await collectorDao.proposals(ProposalId)).forVotes).to.eq(1);

    // CastVoteBySign

    const sig = await sign(signers[1], ProposalId, false, collectorDao.address);
    await collectorDao.castVoteBySig(ProposalId, false, {
      v: sig.v,
      r: sig.r,
      s: sig.s,
    });
    expect((await collectorDao.proposals(ProposalId)).forVotes).to.eq(1);
    expect((await collectorDao.proposals(ProposalId)).againstVotes).to.eq(1);

    expect(
      collectorDao.castVoteBySig(ProposalId, false, {
        v: sig.v,
        r: sig.r,
        s: sig.s,
      })
    ).revertedWith("AlreadyVoted()");
    expect(
      collectorDao.connect(signers[1]).castVote(ProposalId, false)
    ).revertedWith("AlreadyVoted()");

    // CastBulkVotesBySign

    const sig1 = await sign(signers[2], ProposalId, true, collectorDao.address);
    const sig2 = await sign(signers[3], ProposalId, true, collectorDao.address);
    const proposalIds = [ProposalId, ProposalId];
    const supports = [true, true];
    const sigs = [sig1, sig2];

    await collectorDao.castBulkVotesBySig(proposalIds, supports, sigs);

    expect((await collectorDao.proposals(ProposalId)).forVotes).to.eq(3);
    expect((await collectorDao.proposals(ProposalId)).againstVotes).to.eq(1);
  });

  /* ///////////////////////////////////////////////////////////////
                      PROPOSAL EXECUTION
    ////////////////////////////////////////////////////////////// */

  it("Proposal Execution", async function () {
    const targets = [NFTMarketPlaceAddress];
    const values = [toEther("2")];
    const calldata = [
      "0xcce7ec13000000000000000000000000b6001598781747c2b3b8dd889991911524b95c8f0000000000000000000000000000000000000000000000000000000000000001",
    ];
    // Tring execution in Active state
    expect(collectorDao.execute(targets, values, calldata)).revertedWith(
      "'NotSucceededOrAlreadyExecuted()"
    );
    // Going beyond deadline
    while ((await collectorDao.state(ProposalId)) === 3)
      await network.provider.send("evm_mine");
    // state sholud be 4 not 5 as prootcol vote was successful
    expect(await collectorDao.state(ProposalId)).to.eq(4);
    expect(await nftMarketPlace.entered()).to.eq(1);
    await collectorDao.execute(targets, values, calldata);
    expect(await nftMarketPlace.entered()).to.eq(2);
    expect(collectorDao.execute(targets, values, calldata)).revertedWith(
      "'NotSucceededOrAlreadyExecuted()"
    );
    expect(collectorDao.cancel(ProposalId)).revertedWith(
      "ProposalAlreadyExecuted()"
    );
  });
});
