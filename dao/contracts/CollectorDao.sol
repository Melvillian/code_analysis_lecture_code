//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "hardhat/console.sol";

contract CollectorDao {
    // constants
    uint256 public constant MIN_CONTRIBUTION = 1 ether;
    uint256 public constant VOTING_DELAY = 10; // In realworld, we will increase it
    uint256 public constant VOTING_PERIOD = 100; // In realworld, we will increase it
    uint256 public constant QUORUM = 4; // 1/4 = 25% 
    // variables
    mapping(address => bool) public members;
    uint256 public totalMembers;

    struct Receipt {
        bool hasVoted;
        bool support; // no abstain, more here : ./DecisionsAndFlaws.md
    }

    struct Proposal {
        // slot 1
        uint128 startBlock; // @dev packed, by using lower uint : 2**128 -1 is huge
        uint128 endBlock;
        // slot 2
        address proposer;
        bool executed;
        bool canceled;
        // slot 3
        uint128 forVotes;
        uint128 againstVotes;
        mapping(address => Receipt) receipts;
    }

    mapping(uint256 => Proposal) public proposals;

    enum ProposalState {
        Executed,
        Canceled,
        Pending,
        Active,
        Succeeded,
        Defeated
    }
    // did so as in bulk code, it was getting messy, to validate length
    struct Signature {
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    /*///////////////////////////////////////////////////////////////
                      MEMEBERSHIP
    //////////////////////////////////////////////////////////////*/

    // events
    event newMember(address add);

    // errrors
    error IncorrectContribution();
    error AlreadyMember();
    error NotAMember();

    function joinDao() external payable {
        if (msg.value != MIN_CONTRIBUTION) revert IncorrectContribution();
        if (members[msg.sender] != false) revert AlreadyMember(); 
        // @dev This is not a hard req as per spec, but did so, to have 1 member, 1 eth contribution
        
        totalMembers++;
        members[msg.sender] = true;
        emit newMember(msg.sender);
    }

    function isMember(address _add) internal view {
        if (!members[_add]) revert NotAMember();
    }

    /*///////////////////////////////////////////////////////////////
                      PROPOSAL
    //////////////////////////////////////////////////////////////*/

    // events
    event ProposalCreated(
        uint256 proposalId,
        address proposer,
        address[] targets,
        uint256[] values,
        bytes[] calldatas,
        uint256 startBlock,
        uint256 endBlock
    );
    event ProposalExecuted(uint256 proposalId);
    event ProposalCanceled(uint256 proposalId);

    // errors
    error InvalidProposal(string reason);
    error RevertForCall(uint256 proposalId, uint256 position);
    error NotAProposer();
    error NotSucceededOrAlreadyExecuted();
    error ProposalAlreadyCanceled();
    error ProposalAlreadyExecuted();

    function state(uint256 proposalId) public view returns (ProposalState) {
        Proposal storage p = proposals[proposalId];

        if (p.executed) return ProposalState.Executed;
        if (p.canceled) return ProposalState.Canceled;
        if (p.startBlock == 0) revert InvalidProposal("NotDefined");
        if (p.startBlock >= block.number) return ProposalState.Pending;
        if (p.endBlock >= block.number) return ProposalState.Active;
        if (_isSucceeded(p)) return ProposalState.Succeeded;
        return ProposalState.Defeated;
    }

    function hashProposal(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas
    ) public pure returns (uint256) { 
        return uint256(keccak256(abi.encode(targets, values, calldatas)));
    }

    // @dev made it public, so before submitting only proposer can verfiy on client
    function isValidProposal(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas
    ) public view returns (uint256 id) {
        if (targets.length != values.length)
            revert InvalidProposal("targets!=values");
        if (targets.length != calldatas.length)
            revert InvalidProposal("targets!=calldatas");
        if (targets.length == 0) revert InvalidProposal("empty");

        // @dev : Here we have skipped max no of actions check intentially, we leave over that to goverance
        // @dev : As of now, we allow one member to create proposal, even if one of theirs is active

        id = hashProposal(targets, values, calldatas); // inspired from OZ governer

        if (proposals[id].startBlock != 0) revert InvalidProposal("duplicate");
    }

    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas
    ) external returns (uint256) {
        isMember(msg.sender); // Only Memeber can create proposal

        uint256 proposalId = isValidProposal(targets, values, calldatas);
        uint256 _start = block.number + VOTING_DELAY;
        uint256 _end = _start + VOTING_PERIOD;
        proposals[proposalId].startBlock = uint128(_start); // @dev its unrealstic to overflow, current block no. at time of writing is 14044987
        proposals[proposalId].endBlock = uint128(_end);
        proposals[proposalId].proposer = msg.sender;

        emit ProposalCreated(
            proposalId,
            msg.sender,
            targets,
            values,
            calldatas,
            _start,
            _end
        );
        return proposalId;
    }

    function execute(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas
    ) external {
        uint256 proposalId = hashProposal(targets, values, calldatas);
        // Check
        if (state(proposalId) != ProposalState.Succeeded)
            revert NotSucceededOrAlreadyExecuted();

        // Reentrancy Vulnerability!
        // comment this out in order to cause reentrancy proposals[proposalId].executed = true;
        emit ProposalExecuted(proposalId);

        // Interaction

        // @dev : there is a reason we are not using getPrice() and not setting max in proposal
        // Thing is if we set max, a wise nft creator or anyone else would always see that proposal is passed
        // and creator would set floor price to at least that or anyone would buy it and then set it. 
        // so its not that we would be saving something
        // hence we are not adding extra overhead
        // we believe that values[] passed in execute() defines a max dao decided to pay
        // if creator increase above it : execute would fail ofc

        // In a world where max price is hashed by common secret shared by dao members, max price could work 
        // but thats for future to decide

        for (uint256 i = 0; i < targets.length; ++i) {
            (bool success, bytes memory returndata) = targets[i].call{
                value: values[i]
            }(calldatas[i]);
            if (!success) {
                if (returndata.length == 0) revert RevertForCall(proposalId, i);
                assembly {
                    revert(add(32, returndata), mload(returndata))
                }
            }
        }
    }

    function cancel(uint256 proposalId) external {
        if (msg.sender != proposals[proposalId].proposer) revert NotAProposer();

        ProposalState status = state(proposalId);
        if (status == ProposalState.Canceled) revert ProposalAlreadyCanceled();
        if (status == ProposalState.Executed) revert ProposalAlreadyExecuted();

        proposals[proposalId].canceled = true;

        emit ProposalCanceled(proposalId);
    }

    /*///////////////////////////////////////////////////////////////
                          VOTE
    //////////////////////////////////////////////////////////////*/

    // events
    event VoteCast(address indexed voter, uint256 proposalId, bool support);

    // errors
    error VotingClosed();
    error AlreadyVoted();
    error BulkVotesBySigLength();

    function castBulkVotesBySig(
        uint256[] calldata proposalId,
        bool[] calldata support,
        Signature[] calldata sig
    ) external {
        if (
            proposalId.length != support.length &&
            proposalId.length != sig.length
        ) revert BulkVotesBySigLength();

        for (uint256 i = 0; i < proposalId.length; i++) {
            castVoteBySig(proposalId[i], support[i], sig[i]);
        }
    }

     function castVoteBySig(
        uint256 proposalId,
        bool support,
        Signature calldata sig
    ) public {

        // Things included 
        // chain id : to diff between eth testnets
        // address(this) : to diff between multiple collector daos
        // proposalId : to diff votes for diff proposals
        // support : vote
        // prefix : EIP-191
        // hasVoted : protects against replay

        bytes32 domainSeparator = keccak256(
            abi.encode(_getChainId(), address(this))
        );
        bytes32 voteHash = keccak256(abi.encode(proposalId, support));
        bytes32 payloadHash = keccak256(
            abi.encode(domainSeparator, voteHash)
        );
        bytes32 messageHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", payloadHash)
        );

        address signer = ecrecover(messageHash, sig.v, sig.r, sig.s);

        /// @dev here I saw some impl are verifying if signer is non zero
        /// I think as we have isMember being verfied next in _castVote so thats not needed, 
        /// As address(0) cant be memeber :)

        return _castVote(signer, proposalId, support);
    }

    function castVote(uint256 proposalId, bool support) external {
        return _castVote(msg.sender, proposalId, support);
    }

    function _castVote(
        address voter,
        uint256 proposalId,
        bool support
    ) internal {
        isMember(voter);
        if (state(proposalId) != ProposalState.Active) revert VotingClosed();

        Proposal storage proposal = proposals[proposalId];
        Receipt storage receipt = proposal.receipts[voter];

        if (receipt.hasVoted) revert AlreadyVoted();

        if (support) proposal.forVotes++;
        else proposal.againstVotes++;

        receipt.hasVoted = true;
        receipt.support = support;

        emit VoteCast(voter, proposalId, support);
    }
    function _isSucceeded(Proposal storage proposal) internal view returns (bool) {

        // Why quorum considering forVotes and not total turnout ? like compound
        // reason here : ./DecisionsAndFlaws.md

        uint256 quorumVotes = totalMembers / QUORUM;
        if(proposal.forVotes > proposal.againstVotes &&
        proposal.forVotes >= quorumVotes
        ) return true;
        else
        return false;
    }

    function _getChainId() internal view returns (uint256) {
        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        return chainId;
    }
}