/* eslint-disable @typescript-eslint/no-unused-vars */
import * as protobufs from '@farcaster/protobufs';
import { AdminRpcClient, Factories, HubRpcClient, toFarcasterTime } from '@farcaster/utils';
import { ConsoleCommandInterface } from './console';

export class WarpcastTestCommand implements ConsoleCommandInterface {
  constructor(private readonly rpcClient: HubRpcClient, private readonly adminClient: AdminRpcClient) {}

  commandName(): string {
    return 'warpcast';
  }

  shortHelp(): string {
    return 'Setup a hub instance with Fids for test with the warpcast client';
  }

  help(): string {
    return `
        Usage: warpcast.setup()
        `;
  }

  object() {
    return {
      setup: async (): Promise<string> => {
        await this.messageOrderingActions();
        await this.highVolumeActions();
        await this.revokeSignerWithData();

        return 'Done';
      },
    };
  }

  private async getSigners(fid: number, network: number) {
    const signer = Factories.Ed25519Signer.build();
    const custodySigner = Factories.Eip712Signer.build();

    const custodyEvent = Factories.IdRegistryEvent.build({ fid, to: custodySigner.signerKey });
    const _idResult = await this.adminClient.submitIdRegistryEvent(custodyEvent, new protobufs.Metadata());

    const signerAdd = await Factories.SignerAddMessage.create(
      {
        data: { fid, network, signerAddBody: { signer: signer.signerKey } },
      },
      { transient: { signer: custodySigner } }
    );
    const _msgResult = await this.rpcClient.submitMessage(signerAdd, new protobufs.Metadata());

    return { fid, signer, custodySigner };
  }

  private async revokeSignerWithData() {
    const nextFid = 300_000;
    const network = protobufs.FarcasterNetwork.MAINNET;
    const { fid, signer, custodySigner } = await this.getSigners(nextFid, network);

    // Add 100 casts, reactions, userdatas
    for (let i = 0; i < 100; i++) {
      const castAdd = await Factories.CastAddMessage.create(
        { data: { fid, network } },
        { transient: { signer: signer } }
      );
      const _castAddResult = await this.rpcClient.submitMessage(castAdd, new protobufs.Metadata());

      const castAddReaction = await Factories.ReactionAddMessage.create(
        { data: { fid, network, reactionBody: { targetCastId: { fid, hash: castAdd.hash } } } },
        { transient: { signer: signer } }
      );
      const _castAddReactionResult = await this.rpcClient.submitMessage(castAddReaction, new protobufs.Metadata());

      const userDataAdd = await Factories.UserDataAddMessage.create(
        { data: { fid, network } },
        { transient: { signer: signer } }
      );
      const _userDataAddResult = await this.rpcClient.submitMessage(userDataAdd, new protobufs.Metadata());
    }

    // Add 100 verifications
    for (let i = 0; i < 100; i++) {
      // Verify a new Eth address
      const signer = Factories.Ed25519Signer.build();
      const signerAdd = await Factories.SignerAddMessage.create(
        {
          data: { fid, network, signerAddBody: { signer: signer.signerKey } },
        },
        { transient: { signer: custodySigner } }
      );
      const _msgResult = await this.rpcClient.submitMessage(signerAdd, new protobufs.Metadata());

      const verification = await Factories.VerificationAddEthAddressMessage.create(
        { data: { fid, network } },
        { transient: { signer: signer } }
      );
      const _verificationResult = await this.rpcClient.submitMessage(verification, new protobufs.Metadata());
    }

    // And then revoke the signer
    const signerRevoke = await Factories.SignerRemoveMessage.create(
      { data: { fid, network, signerAddBody: { signer: signer.signerKey } } },
      { transient: { signer: custodySigner } }
    );
    const _msgResult = await this.rpcClient.submitMessage(signerRevoke, new protobufs.Metadata());
  }

  private async highVolumeActions() {
    const nextFid = 200_000;
    const network = protobufs.FarcasterNetwork.MAINNET;
    const { fid, signer, custodySigner } = await this.getSigners(nextFid, network);

    // 1. 10_000 CastAdd messages and reactions
    {
      for (let i = 0; i < 10_000; i++) {
        const castAdd = await Factories.CastAddMessage.create(
          { data: { fid, network } },
          { transient: { signer: signer } }
        );
        const _castAddResult = await this.rpcClient.submitMessage(castAdd, new protobufs.Metadata());

        const castAddReaction = await Factories.ReactionAddMessage.create(
          { data: { fid, network, reactionBody: { targetCastId: { fid, hash: castAdd.hash } } } },
          { transient: { signer: signer } }
        );
        const _castAddReactionResult = await this.rpcClient.submitMessage(castAddReaction, new protobufs.Metadata());
      }
    }

    // 2. 100 Verifications and 100 signers arrive is quick succession
    {
      for (let i = 0; i < 100; i++) {
        // Verify a new Eth address
        const signer = Factories.Ed25519Signer.build();
        const signerAdd = await Factories.SignerAddMessage.create(
          {
            data: { fid, network, signerAddBody: { signer: signer.signerKey } },
          },
          { transient: { signer: custodySigner } }
        );
        const _msgResult = await this.rpcClient.submitMessage(signerAdd, new protobufs.Metadata());

        const verification = await Factories.VerificationAddEthAddressMessage.create(
          { data: { fid, network } },
          { transient: { signer: signer } }
        );
        const _verificationResult = await this.rpcClient.submitMessage(verification, new protobufs.Metadata());
      }
    }

    // 3. 100 UserData messages arrive in quick succession
    {
      for (let i = 0; i < 100; i++) {
        const userData = await Factories.UserDataAddMessage.create(
          { data: { fid, network } },
          { transient: { signer: signer } }
        );
        const _userDataResult = await this.rpcClient.submitMessage(userData, new protobufs.Metadata());
      }
    }
  }

  /**
   * This function sets up the connected hub instance for testing with warpcast.
   *
   * It creates a series of Fids, each one in a state that can be tested for in Warpcast.
   * See this ticket for a list of tests: https://github.com/farcasterxyz/hubble/issues/588
   */
  private async messageOrderingActions() {
    let nextFid = 100_000;
    const network = protobufs.FarcasterNetwork.MAINNET;

    // Message Ordering
    // 1. A CastAdd arrives followed by a CastRemove
    {
      const { fid, signer } = await this.getSigners(++nextFid, network);

      const castAdd = await Factories.CastAddMessage.create(
        { data: { fid, network } },
        { transient: { signer: signer } }
      );
      const _castAddResult = await this.rpcClient.submitMessage(castAdd, new protobufs.Metadata());

      const castRemove = await Factories.CastRemoveMessage.create(
        { data: { fid, network, castRemoveBody: { targetHash: castAdd.hash } } },
        { transient: { signer: signer } }
      );
      const _castRemoveResult = await this.rpcClient.submitMessage(castRemove, new protobufs.Metadata());
    }

    // 2. A CastRemove arrives before the CastAdd. The castAdd will never be added
    {
      const { fid, signer } = await this.getSigners(++nextFid, network);

      const castAdd = await Factories.CastAddMessage.create(
        { data: { fid, network } },
        { transient: { signer: signer } }
      );

      const castRemove = await Factories.CastRemoveMessage.create(
        { data: { fid, network, castRemoveBody: { targetHash: castAdd.hash } } },
        { transient: { signer: signer } }
      );

      // remove first
      const _castRemoveResult = await this.rpcClient.submitMessage(castRemove, new protobufs.Metadata());
      const _castAddResult = await this.rpcClient.submitMessage(castAdd, new protobufs.Metadata());
    }

    // 3. A CastAdd for a child is seen without the parent CastAdd
    {
      const { fid, signer } = await this.getSigners(++nextFid, network);

      const castParent = await Factories.CastAddMessage.create(
        { data: { fid, network } },
        { transient: { signer: signer } }
      );
      const castChild = await Factories.CastAddMessage.create(
        { data: { fid, network, castAddBody: { parentCastId: { fid, hash: castParent.hash } } } },
        { transient: { signer: signer } }
      );

      const _castChildResult = await this.rpcClient.submitMessage(castChild, new protobufs.Metadata());
    }

    // 4. A CastAdd for a child is seen before the parent CastAdd
    {
      const { fid, signer } = await this.getSigners(++nextFid, network);

      const castParent = await Factories.CastAddMessage.create(
        { data: { fid, network } },
        { transient: { signer: signer } }
      );

      const castChild = await Factories.CastAddMessage.create(
        { data: { fid, network, castAddBody: { parentCastId: { fid, hash: castParent.hash } } } },
        { transient: { signer: signer } }
      );

      const _castChildResult = await this.rpcClient.submitMessage(castChild, new protobufs.Metadata());
      const _castParentResult = await this.rpcClient.submitMessage(castParent, new protobufs.Metadata());
    }

    // 5. A CastAdd for a child is seen after the parent CastAdd recieved a CastRemove
    {
      const { fid, signer } = await this.getSigners(++nextFid, network);

      const castParent = await Factories.CastAddMessage.create(
        { data: { fid, network } },
        { transient: { signer: signer } }
      );

      const castRemove = await Factories.CastRemoveMessage.create(
        { data: { fid, network, castRemoveBody: { targetHash: castParent.hash } } },
        { transient: { signer: signer } }
      );

      const castChild = await Factories.CastAddMessage.create(
        { data: { fid, network, castAddBody: { parentCastId: { fid, hash: castParent.hash } } } },
        { transient: { signer: signer } }
      );

      const _castAddResult = await this.rpcClient.submitMessage(castParent, new protobufs.Metadata());
      const _castRemoveResult = await this.rpcClient.submitMessage(castRemove, new protobufs.Metadata());
      const _castChildResult = await this.rpcClient.submitMessage(castChild, new protobufs.Metadata());
    }

    // 6. A reactionAdd arrives followed by a reactionRemove
    {
      const { fid, signer } = await this.getSigners(++nextFid, network);

      const castAdd = await Factories.CastAddMessage.create(
        { data: { fid, network } },
        { transient: { signer: signer } }
      );

      const reactionAdd = await Factories.ReactionAddMessage.create(
        { data: { fid, network, reactionBody: { targetCastId: { fid, hash: castAdd.hash } } } },
        { transient: { signer: signer } }
      );

      const reactionRemove = await Factories.ReactionRemoveMessage.create(
        { data: { fid, network, reactionBody: { targetCastId: { fid, hash: castAdd.hash } } } },
        { transient: { signer: signer } }
      );

      const _castAddResult = await this.rpcClient.submitMessage(castAdd, new protobufs.Metadata());
      const _reactionAddResult = await this.rpcClient.submitMessage(reactionAdd, new protobufs.Metadata());
      const _reactionRemoveResult = await this.rpcClient.submitMessage(reactionRemove, new protobufs.Metadata());
    }

    // 7. A reactionRemove arrives before the reactionAdd
    {
      const { fid, signer } = await this.getSigners(++nextFid, network);

      const castAdd = await Factories.CastAddMessage.create(
        { data: { fid, network } },
        { transient: { signer: signer } }
      );

      const reactionAdd = await Factories.ReactionAddMessage.create(
        { data: { fid, network, reactionBody: { targetCastId: { fid, hash: castAdd.hash } } } },
        { transient: { signer: signer } }
      );

      const reactionRemove = await Factories.ReactionRemoveMessage.create(
        { data: { fid, network, reactionBody: { targetCastId: { fid, hash: castAdd.hash } } } },
        { transient: { signer: signer } }
      );

      const _castAddResult = await this.rpcClient.submitMessage(castAdd, new protobufs.Metadata());
      const _reactionRemoveResult = await this.rpcClient.submitMessage(reactionRemove, new protobufs.Metadata());
      const _reactionAddResult = await this.rpcClient.submitMessage(reactionAdd, new protobufs.Metadata());
    }

    // 8. A reactionAdd arrives after the reactionRemove. The reactionAdd will error because it has already been removed
    {
      const { fid, signer } = await this.getSigners(++nextFid, network);

      const castAdd = await Factories.CastAddMessage.create(
        { data: { fid, network } },
        { transient: { signer: signer } }
      );

      const reactionAdd = await Factories.ReactionAddMessage.create(
        { data: { fid, network, reactionBody: { targetCastId: { fid, hash: castAdd.hash } } } },
        { transient: { signer: signer } }
      );

      const reactionRemove = await Factories.ReactionRemoveMessage.create(
        { data: { fid, network, reactionBody: { targetCastId: { fid, hash: castAdd.hash } } } },
        { transient: { signer: signer } }
      );

      const _castAddResult = await this.rpcClient.submitMessage(castAdd, new protobufs.Metadata());

      const _reactionRemoveResult = await this.rpcClient.submitMessage(reactionRemove, new protobufs.Metadata());
      const _reactionAddResult = await this.rpcClient.submitMessage(reactionAdd, new protobufs.Metadata());
    }

    // 9. A UserDataAdd for time t+1 arrives before a UserDataAdd for time t. Note: The UserDataAdd for time t will error because it conflicts with T+1
    {
      const { fid, signer } = await this.getSigners(++nextFid, network);

      const timestamp = toFarcasterTime(Date.now())._unsafeUnwrap();

      const userDataT = await Factories.UserDataAddMessage.create(
        { data: { timestamp, fid, network, userDataBody: { type: protobufs.UserDataType.BIO } } },
        { transient: { signer: signer } }
      );
      const userDataT1 = await Factories.UserDataAddMessage.create(
        {
          data: {
            timestamp: timestamp + 1,
            fid,
            network,
            userDataBody: { type: protobufs.UserDataType.BIO },
          },
        },
        { transient: { signer: signer } }
      );

      const _userDataT1Result = await this.rpcClient.submitMessage(userDataT1, new protobufs.Metadata());
      const _userDataTResult = await this.rpcClient.submitMessage(userDataT, new protobufs.Metadata());
    }

    // 10. A VerificationRemove arrives without a VerificationAdd.
    {
      const { fid, signer, custodySigner } = await this.getSigners(++nextFid, network);

      const verificationRemove = await Factories.VerificationRemoveMessage.create(
        { data: { fid, network, verificationRemoveBody: { address: custodySigner.signerKey } } },
        { transient: { signer } }
      );

      const _verificationRemoveResult = await this.rpcClient.submitMessage(
        verificationRemove,
        new protobufs.Metadata()
      );
    }

    // 11. A VerificationAdd arrives after a VerificationRemove. This will fail because the VerificationAdd is not valid
    {
      const { fid, signer, custodySigner } = await this.getSigners(++nextFid, network);

      const verificationAdd = await Factories.VerificationAddEthAddressMessage.create(
        { data: { fid, network } },
        { transient: { signer } }
      );
      const verificationRemove = await Factories.VerificationRemoveMessage.create(
        {
          data: {
            fid,
            network,
            verificationRemoveBody: { address: verificationAdd.data.verificationAddEthAddressBody.address },
          },
        },
        { transient: { signer } }
      );

      const _verificationRemoveResult = await this.rpcClient.submitMessage(
        verificationRemove,
        new protobufs.Metadata()
      );
      const _verificationAddResult = await this.rpcClient.submitMessage(verificationAdd, new protobufs.Metadata());
    }
  }
}
