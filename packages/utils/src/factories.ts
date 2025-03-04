import { faker } from '@faker-js/faker';
import { Factory } from '@farcaster/fishery';
import * as protobufs from '@farcaster/protobufs';
import { utils } from '@noble/ed25519';
import { blake3 } from '@noble/hashes/blake3';
import { BigNumber, ethers } from 'ethers';
import { bytesToHexString } from './bytes';
import { Ed25519Signer, Eip712Signer, Signer } from './signers';
import { getFarcasterTime } from './time';
import { VerificationEthAddressClaim } from './verifications';

/** Scalars */

const FidFactory = Factory.define<number>(() => {
  return faker.datatype.number({ min: 1 });
});

const BytesFactory = Factory.define<Uint8Array, { length?: number }>(({ transientParams }) => {
  const length = transientParams.length ?? faker.datatype.number({ max: 64, min: 1 });
  return utils.randomBytes(length);
});

const MessageHashFactory = Factory.define<Uint8Array>(() => {
  return BytesFactory.build({}, { transient: { length: 20 } }); // 160 bits
});

const FnameFactory = Factory.define<Uint8Array>(() => {
  const length = faker.datatype.number({ min: 1, max: 16 });
  const bytes = new Uint8Array(length);

  //  The name begins with [a-z 0-9] or the ascii numbers [48-57, 97-122] inclusive
  bytes.set(
    [
      faker.helpers.arrayElement([
        faker.datatype.number({ min: 48, max: 57 }),
        faker.datatype.number({ min: 97, max: 122 }),
      ]),
    ],
    0
  );

  // The name can contain [a-z 0-9 -] or the ascii numbers [45, 48-57, 97-122] inclusive
  for (let i = 1; i < length; i++) {
    bytes.set(
      [
        faker.helpers.arrayElement([
          45,
          faker.datatype.number({ min: 48, max: 57 }),
          faker.datatype.number({ min: 97, max: 122 }),
        ]),
      ],
      i
    );
  }

  return bytes;
});

/** Eth */

const BlockHashFactory = Factory.define<Uint8Array>(() => {
  return BytesFactory.build({}, { transient: { length: 32 } });
});

const EthAddressFactory = Factory.define<Uint8Array>(() => {
  return BytesFactory.build({}, { transient: { length: 20 } });
});

const TransactionHashFactory = Factory.define<Uint8Array>(() => {
  return BytesFactory.build(undefined, { transient: { length: 32 } });
});

/** Signers */

const Ed25519PrivateKeyFactory = Factory.define<Uint8Array>(() => {
  return utils.randomPrivateKey();
});

const Ed25519SignerFactory = Factory.define<Ed25519Signer>(() => {
  return Ed25519Signer.fromPrivateKey(Ed25519PrivateKeyFactory.build())._unsafeUnwrap();
});

const Ed25519SignatureFactory = Factory.define<Uint8Array>(() => {
  return BytesFactory.build({}, { transient: { length: 64 } });
});

const Eip712SignerFactory = Factory.define<Eip712Signer>(() => {
  const wallet = new ethers.Wallet(utils.randomBytes(32));
  return Eip712Signer.fromSigner(wallet, wallet.address)._unsafeUnwrap();
});

const Eip712SignatureFactory = Factory.define<Uint8Array>(() => {
  return BytesFactory.build(undefined, { transient: { length: 65 } });
});

/** Message Protobufs */

const CastIdFactory = Factory.define<protobufs.CastId>(() => {
  return protobufs.CastId.create({
    fid: FidFactory.build(),
    hash: MessageHashFactory.build(),
  });
});

const FarcasterNetworkFactory = Factory.define<protobufs.FarcasterNetwork>(() => {
  return faker.helpers.arrayElement([
    protobufs.FarcasterNetwork.DEVNET,
    protobufs.FarcasterNetwork.MAINNET,
    protobufs.FarcasterNetwork.TESTNET,
  ]);
});

const ReactionTypeFactory = Factory.define<protobufs.ReactionType>(() => {
  return faker.helpers.arrayElement([protobufs.ReactionType.LIKE, protobufs.ReactionType.RECAST]);
});

const UserDataTypeFactory = Factory.define<protobufs.UserDataType>(() => {
  return faker.helpers.arrayElement([
    protobufs.UserDataType.BIO,
    protobufs.UserDataType.DISPLAY,
    protobufs.UserDataType.FNAME,
    protobufs.UserDataType.PFP,
    protobufs.UserDataType.URL,
  ]);
});

const MessageTypeFactory = Factory.define<protobufs.MessageType>(() => {
  return faker.helpers.arrayElement([
    protobufs.MessageType.CAST_ADD,
    protobufs.MessageType.CAST_REMOVE,
    protobufs.MessageType.REACTION_ADD,
    protobufs.MessageType.REACTION_REMOVE,
    protobufs.MessageType.SIGNER_ADD,
    protobufs.MessageType.SIGNER_REMOVE,
    protobufs.MessageType.USER_DATA_ADD,
    protobufs.MessageType.VERIFICATION_ADD_ETH_ADDRESS,
    protobufs.MessageType.VERIFICATION_REMOVE,
  ]);
});

const MessageFactory = Factory.define<protobufs.Message, { signer?: Ed25519Signer | Eip712Signer }, protobufs.Message>(
  ({ onCreate, transientParams }) => {
    onCreate(async (message: protobufs.Message) => {
      if (!message.data) {
        return message;
      }

      // Generate hash
      const dataBytes = protobufs.MessageData.encode(message.data).finish();
      if (message.hash.length === 0) {
        message.hash = blake3(dataBytes, { dkLen: 20 });
      }

      // Set signer
      const isEip712Signer =
        message.data.type === protobufs.MessageType.SIGNER_ADD ||
        message.data.type === protobufs.MessageType.SIGNER_REMOVE;
      const signer: Signer =
        transientParams.signer ?? (isEip712Signer ? Eip712SignerFactory.build() : Ed25519SignerFactory.build());

      // Generate signature
      if (message.signature.length === 0) {
        const signature = await signer.signMessageHash(message.hash);
        message.signature = signature._unsafeUnwrap();
      }

      if (!message.signatureScheme) {
        message.signatureScheme = signer.scheme;
      }

      if (message.signer.length === 0) {
        message.signer = signer.signerKey;
      }

      return message;
    });

    return protobufs.Message.create({
      data: CastAddDataFactory.build(),
      hashScheme: protobufs.HashScheme.BLAKE3,
    });
  }
);

const MessageDataFactory = Factory.define<protobufs.MessageData>(() => {
  return protobufs.MessageData.create({
    fid: FidFactory.build(),
    timestamp: getFarcasterTime()._unsafeUnwrap(),
    network: protobufs.FarcasterNetwork.TESTNET,
  });
});

const CastAddBodyFactory = Factory.define<protobufs.CastAddBody>(() => {
  const text = faker.lorem.sentence(12);
  return protobufs.CastAddBody.create({
    embeds: [faker.internet.url(), faker.internet.url()],
    mentions: [FidFactory.build(), FidFactory.build(), FidFactory.build()],
    mentionsPositions: [0, Math.floor(text.length / 2), text.length], // Hack to avoid duplicates
    parentCastId: CastIdFactory.build(),
    text,
  });
});

const CastAddDataFactory = Factory.define<protobufs.CastAddData>(() => {
  return MessageDataFactory.build({
    castAddBody: CastAddBodyFactory.build(),
    type: protobufs.MessageType.CAST_ADD,
  }) as protobufs.CastAddData;
});

const CastAddMessageFactory = Factory.define<protobufs.CastAddMessage, { signer?: Ed25519Signer }>(
  ({ onCreate, transientParams }) => {
    onCreate((message) => {
      return MessageFactory.create(message, { transient: transientParams }) as Promise<protobufs.CastAddMessage>;
    });

    return MessageFactory.build(
      { data: CastAddDataFactory.build(), signatureScheme: protobufs.SignatureScheme.ED25519 },
      { transient: transientParams }
    ) as protobufs.CastAddMessage;
  }
);

const CastRemoveBodyFactory = Factory.define<protobufs.CastRemoveBody>(() => {
  return protobufs.CastRemoveBody.create({
    targetHash: MessageHashFactory.build(),
  });
});

const CastRemoveDataFactory = Factory.define<protobufs.CastRemoveData>(() => {
  return MessageDataFactory.build({
    castRemoveBody: CastRemoveBodyFactory.build(),
    type: protobufs.MessageType.CAST_REMOVE,
  }) as protobufs.CastRemoveData;
});

const CastRemoveMessageFactory = Factory.define<protobufs.CastRemoveMessage, { signer?: Ed25519Signer }>(
  ({ onCreate, transientParams }) => {
    onCreate((message) => {
      return MessageFactory.create(message, { transient: transientParams }) as Promise<protobufs.CastRemoveMessage>;
    });

    return MessageFactory.build(
      { data: CastRemoveDataFactory.build(), signatureScheme: protobufs.SignatureScheme.ED25519 },
      { transient: transientParams }
    ) as protobufs.CastRemoveMessage;
  }
);

const ReactionBodyFactory = Factory.define<protobufs.ReactionBody>(() => {
  return protobufs.ReactionBody.create({
    targetCastId: CastIdFactory.build(),
    type: ReactionTypeFactory.build(),
  });
});

const ReactionAddDataFactory = Factory.define<protobufs.ReactionAddData>(() => {
  return MessageDataFactory.build({
    reactionBody: ReactionBodyFactory.build(),
    type: protobufs.MessageType.REACTION_ADD,
  }) as protobufs.ReactionAddData;
});

const ReactionAddMessageFactory = Factory.define<protobufs.ReactionAddMessage, { signer?: Ed25519Signer }>(
  ({ onCreate, transientParams }) => {
    onCreate((message) => {
      return MessageFactory.create(message, { transient: transientParams }) as Promise<protobufs.ReactionAddMessage>;
    });

    return MessageFactory.build(
      { data: ReactionAddDataFactory.build(), signatureScheme: protobufs.SignatureScheme.ED25519 },
      { transient: transientParams }
    ) as protobufs.ReactionAddMessage;
  }
);

const ReactionRemoveDataFactory = Factory.define<protobufs.ReactionRemoveData>(() => {
  return MessageDataFactory.build({
    reactionBody: ReactionBodyFactory.build(),
    type: protobufs.MessageType.REACTION_REMOVE,
  }) as protobufs.ReactionRemoveData;
});

const ReactionRemoveMessageFactory = Factory.define<protobufs.ReactionRemoveMessage, { signer?: Ed25519Signer }>(
  ({ onCreate, transientParams }) => {
    onCreate((message) => {
      return MessageFactory.create(message, { transient: transientParams }) as Promise<protobufs.ReactionRemoveMessage>;
    });

    return MessageFactory.build(
      { data: ReactionRemoveDataFactory.build(), signatureScheme: protobufs.SignatureScheme.ED25519 },
      { transient: transientParams }
    ) as protobufs.ReactionRemoveMessage;
  }
);

const SignerAddBodyFactory = Factory.define<protobufs.SignerAddBody>(() => {
  return protobufs.SignerAddBody.create({
    name: faker.random.alphaNumeric(16),
    signer: Ed25519SignerFactory.build().signerKey,
  });
});

const SignerAddDataFactory = Factory.define<protobufs.SignerAddData>(() => {
  return MessageDataFactory.build({
    signerAddBody: SignerAddBodyFactory.build(),
    type: protobufs.MessageType.SIGNER_ADD,
  }) as protobufs.SignerAddData;
});

const SignerAddMessageFactory = Factory.define<protobufs.SignerAddMessage, { signer?: Eip712Signer }>(
  ({ onCreate, transientParams }) => {
    onCreate((message) => {
      return MessageFactory.create(message, { transient: transientParams }) as Promise<protobufs.SignerAddMessage>;
    });

    return MessageFactory.build(
      { data: SignerAddDataFactory.build(), signatureScheme: protobufs.SignatureScheme.EIP712 },
      { transient: transientParams }
    ) as protobufs.SignerAddMessage;
  }
);

const SignerRemoveBodyFactory = Factory.define<protobufs.SignerRemoveBody>(() => {
  return protobufs.SignerRemoveBody.create({
    signer: Ed25519SignerFactory.build().signerKey,
  });
});

const SignerRemoveDataFactory = Factory.define<protobufs.SignerRemoveData>(() => {
  return MessageDataFactory.build({
    signerRemoveBody: SignerRemoveBodyFactory.build(),
    type: protobufs.MessageType.SIGNER_REMOVE,
  }) as protobufs.SignerRemoveData;
});

const SignerRemoveMessageFactory = Factory.define<protobufs.SignerRemoveMessage, { signer?: Eip712Signer }>(
  ({ onCreate, transientParams }) => {
    onCreate((message) => {
      return MessageFactory.create(message, { transient: transientParams }) as Promise<protobufs.SignerRemoveMessage>;
    });

    return MessageFactory.build(
      { data: SignerRemoveDataFactory.build(), signatureScheme: protobufs.SignatureScheme.EIP712 },
      { transient: transientParams }
    ) as protobufs.SignerRemoveMessage;
  }
);

const VerificationEthAddressClaimFactory = Factory.define<VerificationEthAddressClaim, { signer?: Eip712Signer }>(
  ({ transientParams }) => {
    const signer = transientParams.signer ?? Eip712SignerFactory.build();
    const address = bytesToHexString(signer.signerKey)._unsafeUnwrap();
    const blockHash = bytesToHexString(BlockHashFactory.build())._unsafeUnwrap();

    return {
      fid: BigNumber.from(FidFactory.build()),
      address,
      network: FarcasterNetworkFactory.build(),
      blockHash,
    };
  }
);

const VerificationAddEthAddressBodyFactory = Factory.define<
  protobufs.VerificationAddEthAddressBody,
  { ethSigner?: Eip712Signer; fid?: number; network?: protobufs.FarcasterNetwork },
  protobufs.VerificationAddEthAddressBody
>(({ onCreate, transientParams }) => {
  const ethSigner = transientParams.ethSigner ?? Eip712SignerFactory.build();

  onCreate(async (body) => {
    if (body.ethSignature.length === 0) {
      // Generate address and signature
      const fid = transientParams.fid ?? FidFactory.build();
      const network = transientParams.network ?? FarcasterNetworkFactory.build();
      const blockHash = bytesToHexString(body.blockHash);
      const claim = VerificationEthAddressClaimFactory.build(
        { fid: BigNumber.from(fid), network, blockHash: blockHash.isOk() ? blockHash.value : '0x' },
        { transient: { signer: ethSigner } }
      );
      const ethSignature = await ethSigner.signVerificationEthAddressClaim(claim);
      if (ethSignature.isOk()) {
        body.ethSignature = ethSignature.value;
      }
    }

    return body;
  });

  return protobufs.VerificationAddEthAddressBody.create({
    address: ethSigner.signerKey,
    blockHash: BlockHashFactory.build(),
  });
});

const VerificationAddEthAddressDataFactory = Factory.define<
  protobufs.VerificationAddEthAddressData,
  { ethSigner?: Eip712Signer }
>(({ onCreate, transientParams }) => {
  const ethSigner: Eip712Signer = transientParams.ethSigner ?? Eip712SignerFactory.build();

  onCreate(async (data) => {
    const body = data.verificationAddEthAddressBody;
    if (body.ethSignature.length === 0) {
      const signedBody = await VerificationAddEthAddressBodyFactory.create(body, {
        transient: { ethSigner, fid: data.fid, network: data.network },
      });
      data.verificationAddEthAddressBody = signedBody;
    }
    return data;
  });

  return MessageDataFactory.build({
    // verificationAddEthAddressBody will not be valid until onCreate
    verificationAddEthAddressBody: VerificationAddEthAddressBodyFactory.build({}, { transient: { ethSigner } }),
    type: protobufs.MessageType.VERIFICATION_ADD_ETH_ADDRESS,
  }) as protobufs.VerificationAddEthAddressData;
});

const VerificationAddEthAddressMessageFactory = Factory.define<
  protobufs.VerificationAddEthAddressMessage,
  { signer?: Ed25519Signer; ethSigner?: Eip712Signer }
>(({ onCreate, transientParams }) => {
  const ethSigner: Eip712Signer = transientParams.ethSigner ?? Eip712SignerFactory.build();
  const signer: Ed25519Signer = transientParams.signer ?? Ed25519SignerFactory.build();

  onCreate(async (message) => {
    message.data = await VerificationAddEthAddressDataFactory.create(message.data, { transient: { ethSigner } });
    return MessageFactory.create(message, {
      transient: { signer },
    }) as Promise<protobufs.VerificationAddEthAddressMessage>;
  });

  return MessageFactory.build(
    {
      data: VerificationAddEthAddressDataFactory.build({}, { transient: { ethSigner } }),
    },
    { transient: { signer } }
  ) as protobufs.VerificationAddEthAddressMessage;
});

const VerificationRemoveBodyFactory = Factory.define<protobufs.VerificationRemoveBody>(() => {
  return protobufs.VerificationRemoveBody.create({
    address: EthAddressFactory.build(),
  });
});

const VerificationRemoveDataFactory = MessageDataFactory.params({
  verificationRemoveBody: VerificationRemoveBodyFactory.build(),
  type: protobufs.MessageType.VERIFICATION_REMOVE,
}) as Factory<protobufs.VerificationRemoveData>;

const VerificationRemoveMessageFactory = MessageFactory.params({
  data: VerificationRemoveDataFactory.build(),
  signatureScheme: protobufs.SignatureScheme.ED25519,
}) as Factory<protobufs.VerificationRemoveMessage, { signer?: Ed25519Signer }>;

const UserDataBodyFactory = Factory.define<protobufs.UserDataBody>(() => {
  return protobufs.UserDataBody.create({
    type: UserDataTypeFactory.build(),
    value: faker.random.alphaNumeric(16), // 16 chars to stay within range for all UserDataAdd types
  });
});

const UserDataAddDataFactory = Factory.define<protobufs.UserDataAddData>(() => {
  return MessageDataFactory.build({
    userDataBody: UserDataBodyFactory.build(),
    type: protobufs.MessageType.USER_DATA_ADD,
  }) as protobufs.UserDataAddData;
});

const UserDataAddMessageFactory = Factory.define<protobufs.UserDataAddMessage, { signer?: Ed25519Signer }>(
  ({ onCreate, transientParams }) => {
    onCreate((message) => {
      return MessageFactory.create(message, { transient: transientParams }) as Promise<protobufs.UserDataAddMessage>;
    });

    return MessageFactory.build(
      { data: UserDataAddDataFactory.build(), signatureScheme: protobufs.SignatureScheme.ED25519 },
      { transient: transientParams }
    ) as protobufs.UserDataAddMessage;
  }
);

/** Event Protobufs */

const IdRegistryEventTypeFactory = Factory.define<protobufs.IdRegistryEventType>(() => {
  return faker.helpers.arrayElement([protobufs.IdRegistryEventType.REGISTER, protobufs.IdRegistryEventType.TRANSFER]);
});

const IdRegistryEventFactory = Factory.define<protobufs.IdRegistryEvent>(() => {
  return protobufs.IdRegistryEvent.create({
    blockNumber: faker.datatype.number({ min: 1, max: 100_000 }),
    blockHash: BlockHashFactory.build(),
    transactionHash: TransactionHashFactory.build(),
    logIndex: faker.datatype.number({ min: 0, max: 1_000 }),
    fid: FidFactory.build(),
    to: EthAddressFactory.build(),
    type: IdRegistryEventTypeFactory.build(),
    from: EthAddressFactory.build(),
  });
});

const NameRegistryEventTypeFactory = Factory.define<protobufs.NameRegistryEventType>(() => {
  return faker.helpers.arrayElement([protobufs.NameRegistryEventType.RENEW, protobufs.NameRegistryEventType.TRANSFER]);
});

const NameRegistryEventFactory = Factory.define<protobufs.NameRegistryEvent>(() => {
  return protobufs.NameRegistryEvent.create({
    blockNumber: faker.datatype.number({ min: 1, max: 100_000 }),
    blockHash: BlockHashFactory.build(),
    transactionHash: TransactionHashFactory.build(),
    logIndex: faker.datatype.number({ min: 0, max: 1_000 }),
    fname: FnameFactory.build(),
    to: EthAddressFactory.build(),
    type: NameRegistryEventTypeFactory.build(),
    from: EthAddressFactory.build(),
    expiry: getFarcasterTime()._unsafeUnwrap() + 60 * 60 * 24 * 365, // a year
  });
});

export const Factories = {
  Fid: FidFactory,
  Fname: FnameFactory,
  Bytes: BytesFactory,
  MessageHash: MessageHashFactory,
  BlockHash: BlockHashFactory,
  EthAddress: EthAddressFactory,
  TransactionHash: TransactionHashFactory,
  Ed25519PrivateKey: Ed25519PrivateKeyFactory,
  Ed25519Signer: Ed25519SignerFactory,
  Ed25519Signature: Ed25519SignatureFactory,
  Eip712Signer: Eip712SignerFactory,
  Eip712Signature: Eip712SignatureFactory,
  CastId: CastIdFactory,
  FarcasterNetwork: FarcasterNetworkFactory,
  ReactionType: ReactionTypeFactory,
  MessageType: MessageTypeFactory,
  MessageData: MessageDataFactory,
  Message: MessageFactory,
  CastAddBody: CastAddBodyFactory,
  CastAddData: CastAddDataFactory,
  CastAddMessage: CastAddMessageFactory,
  CastRemoveBody: CastRemoveBodyFactory,
  CastRemoveData: CastRemoveDataFactory,
  CastRemoveMessage: CastRemoveMessageFactory,
  ReactionBody: ReactionBodyFactory,
  ReactionAddData: ReactionAddDataFactory,
  ReactionAddMessage: ReactionAddMessageFactory,
  ReactionRemoveData: ReactionRemoveDataFactory,
  ReactionRemoveMessage: ReactionRemoveMessageFactory,
  SignerAddBody: SignerAddBodyFactory,
  SignerRemoveBody: SignerRemoveBodyFactory,
  SignerAddData: SignerAddDataFactory,
  SignerAddMessage: SignerAddMessageFactory,
  SignerRemoveData: SignerRemoveDataFactory,
  SignerRemoveMessage: SignerRemoveMessageFactory,
  VerificationEthAddressClaim: VerificationEthAddressClaimFactory,
  VerificationAddEthAddressBody: VerificationAddEthAddressBodyFactory,
  VerificationAddEthAddressData: VerificationAddEthAddressDataFactory,
  VerificationAddEthAddressMessage: VerificationAddEthAddressMessageFactory,
  VerificationRemoveBody: VerificationRemoveBodyFactory,
  VerificationRemoveData: VerificationRemoveDataFactory,
  VerificationRemoveMessage: VerificationRemoveMessageFactory,
  UserDataBody: UserDataBodyFactory,
  UserDataAddData: UserDataAddDataFactory,
  UserDataAddMessage: UserDataAddMessageFactory,
  IdRegistryEventType: IdRegistryEventTypeFactory,
  IdRegistryEvent: IdRegistryEventFactory,
  NameRegistryEventType: NameRegistryEventTypeFactory,
  NameRegistryEvent: NameRegistryEventFactory,
};
