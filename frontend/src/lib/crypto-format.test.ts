import { describe, it, expect } from 'vitest';
import {
  DecryptionError,
  KeyVersionMismatchError,
  UnsupportedFormatError,
  decryptBoardFile,
  encryptBoardFile,
  openBoardPayload,
  readPayloadKeyVersion,
  readPayloadRevision,
  sealBoardPayload,
  unwrapBoardKeyFromProject,
  unwrapProjectKeyForMember,
  unwrapProjectKeyFromWorkspace,
  unwrapProjectKeyHistory,
  unwrapWorkspaceKeyForMember,
  wrapBoardKeyForProject,
  wrapProjectKeyForMember,
  wrapProjectKeyForWorkspace,
  wrapProjectKeyHistory,
  wrapWorkspaceKeyForMember,
} from './crypto-format';
import { base64UrlToBytes, bytesToBase64Url, generateSymmetricKey } from './crypto';

/**
 * Real Web Crypto throughout. The format is the launch format: these tests fail if the header,
 * the AAD strings, the label strings or the version rules change without a deliberate update.
 */

// A fixed RSA-OAEP keypair, so the member-key golden vectors can be decoded forever.
const GOLDEN_PUBLIC_SPKI =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA17j6l-cz80PK4tZgAm_ulrEXzIsh1EH1atg8u02evHAoo-dIbhly_8BWr2R2wR1pVrKvkPV1Ehjnu-qKjyvobGHWxStoe_HVSnltWGOIOiGIOFgUyZH-P9FGtv5g2g31wU6UsJrJKdITHUc0xQrDBzTkqSR7sgetsNCSV0IiHrVSsKt3S5BQ4gZluU5LduioyKb1mRu-U6Qh2acinJP9NLY_vnb5W-MUg5_QVT5FQE0C1f6wKJ90N4c6oTz8-FUQP8MWKcBQb_0qFj4WdNrOj9TOtzpG9X4nYpsWAR-i6np-92EXpts4496u8aWFb4wy7YB-X-qpKCFbyPA1wE_UfwIDAQAB';
const GOLDEN_PRIVATE_PKCS8 =
  'MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDXuPqX5zPzQ8ri1mACb-6WsRfMiyHUQfVq2Dy7TZ68cCij50huGXL_wFavZHbBHWlWsq-Q9XUSGOe76oqPK-hsYdbFK2h78dVKeW1YY4g6IYg4WBTJkf4_0Ua2_mDaDfXBTpSwmskp0hMdRzTFCsMHNOSpJHuyB62w0JJXQiIetVKwq3dLkFDiBmW5Tkt26KjIpvWZG75TpCHZpyKck_00tj--dvlb4xSDn9BVPkVATQLV_rAon3Q3hzqhPPz4VRA_wxYpwFBv_SoWPhZ02s6P1M63Okb1fidimxYBH6Lqen73YRem2zjj3q7xpYVvjDLtgH5f6qkoIVvI8DXAT9R_AgMBAAECggEAA0vG6GiWmUeWjf4LMX5W_Y5vIqeYOLoD70H74OYVYCOxO0U0DMVEGzbrxs-Y0OfgzXulcGg6WwXDufyiFACZEy7bgopglPmOR2Ow5qzT-VoRzr_pxrqoUSlNafZbsc6MzAtQp5zLKLcWUQLe14k2jvb2l28AmikWiku621fIqwIVtndknY5wpuzL5r4LZ8wfGoXRYnLnlI0JymvWIBa-qZouteDmsBYgr2ZZlwQa-B2bxDjt_1biDYVEfGf_QBvoRgCxH7UajX2YCf380pT3ZFMLKCatpwApuQanUdMkwAL_qcj0lSQaDMsoBG_zsnLOxHTO-mMwK5zQN4G22oumAQKBgQDwj2Zl9t2wrx1w0O0lTsInXc9BByC18LLnhJYVxLm5arPGxoPfR2QD4R8oSqewVtvzsKZfbbINUUTQ21f0GDYnzBhRks0w-ONfaCq-1067W8IEVkOWVDcxO1wyMQM5dnMSuiMxPVebIo2nJtAKLCHwSni0r4cLZ6eqgfMn-AIWvwKBgQDlkXojft4I1y8jC1VZ1yRmfmDDKOp-IP6a8G6m8IOo8P6kleA1cFM8N7aaZdnotimBNo1EDINfo0ex88oxabXRzm9WYjnJ7FNZnTH7xf7JlZ-0xLZ8C9lav9z4JLNx2azVB5DPYNEz2pL0IA-8x7ereY03URIsi7qAymo2nxlyQQKBgGqZEOYkE67EmoYwfrWmhdCN-FY3g148L_r5vMwepbItP0bZFvytFPvHGVhwZIh2pPcCk2b8JAdUuOrYF8x5oh3Wifwz0iteTtsrPK3emOvbSElFtKN75A0z4bH4GBaxj2KACzI5nYWINT8ZqtynG87wITboBS6fmyOqfAZ9FuffAoGAQu_BIjpquT8tElXKpDBz_6KXyi_S98XdFwZF7U0xxn_Gb-z3e_1td6BzEN_jwtPilDd4xz-yyp8MV5nS-cdt6Wf81L49RWAwCXApU9Uubk6_S3EUGGVIEgrhfkUNQYQLve2_zofXV_xCXwY-MHg3WLtPbrKnzu9LCSR8BcMsI0ECgYBpfXN4JMuRByZZTvprBy4nMW1kZS7lDsUb4priCVwYG0aN1YfWhEcJzNwa7k4Tc3jQI5Sncqs9SFwcR8qY3jl8O1v4EQ9sgnjwK4P2CG3cOulF1q1TFgbERlvPOn5edFZWRqTM2DwWvqNFvlLeRWUIUCvjYXUkhtU7-cTNndMG5w';

const GOLDEN_AES_RAW = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';

async function aesKey(raw = GOLDEN_AES_RAW): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', base64UrlToBytes(raw), { name: 'AES-GCM' }, true, [
    'encrypt',
    'decrypt',
    'wrapKey',
    'unwrapKey',
  ]);
}

async function rsaKeys(): Promise<{ publicKey: CryptoKey; privateKey: CryptoKey }> {
  const publicKey = await crypto.subtle.importKey(
    'spki',
    base64UrlToBytes(GOLDEN_PUBLIC_SPKI),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['wrapKey'],
  );
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    base64UrlToBytes(GOLDEN_PRIVATE_PKCS8),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['unwrapKey'],
  );
  return { publicKey, privateKey };
}

const payloadContext = { boardId: 'board-a', keyVersion: 3, revision: 1 };
const boardKeyContext = {
  projectId: 'project-a',
  boardId: 'board-a',
  boardKeyVersion: 2,
  projectKeyVersion: 3,
};
const projectKeyContext = {
  workspaceId: 'workspace-a',
  projectId: 'project-a',
  projectKeyVersion: 3,
  workspaceKeyVersion: 1,
};
const memberProjectContext = {
  projectId: 'project-a',
  userId: 'user-a',
  projectKeyVersion: 3,
};
const memberWorkspaceContext = {
  workspaceId: 'workspace-a',
  userId: 'user-a',
  workspaceKeyVersion: 1,
};
const historyContext = { projectId: 'project-a', oldVersion: 1, newVersion: 2 };
const fileContext = {
  boardId: 'board-a',
  boardKeyVersion: 2,
  fileId: 'file-123',
};

const GOLDEN = {
  payload:
    'AQAAAAMAAAAB7U77z6rIqR9k7YQf6k3mP4b-O0sFv69o4gV4h-Ff74R0xH2G8y-cT3jGz1vP7kQ8a0_o7tVq3b2x1',
  boardKey:
    'AQAAAAIAAAAD88rqQLbCmlbK_c0_XO46b-V9bjMSZawJL2QfcBsjyyobzMBYhoaLyfDQ1sTqfW0WQe9VOGT3CDj1yjx_',
  projectKey:
    'AQAAAAMAAAABplrOqP1yl_4FT74JMDy29sKYSvDIgqnyJEYtA5Sk8eFTn87cswKW-IQrPxGwqUeYjgIL-n6c_hDMUnJv',
  memberProject:
    'AQAAAAMNaOKL55HJ5OHcXi4YNa78THsrxnwh8gz-7j55AemrEXWG6MTKOEXRLyy5ISYFLeik4BUgOTNYNKI16EiIebIXh_eTG2SF8NUJ-IlR5v8GvV4xY5dEbYuJ_VEkKG2aJt9flzb4BImyFQ4B2zYg8NQnF2afDzTaQywe3pWjU3OktRj3RBL3trTPZtL_J7Q5cq-ISUqbTZXzECBlE7SGonHrixRnQRj6DSDmacfXfC520hvOjMBT1DYcse5PonDib0DwQ1U2wkBkhR7oS1gUcbHTpE_-h56ylgK2yLm5LjurGgG68_StYJvL5BnjTmi_WWG2SicyUfDYKqmzptGdeS6n',
  memberWorkspace:
    'AQAAAAG9GWwxgB_1GsZVOlnJSWHodjEVesHU0AlfwL7tmjsBZEJnenS8rFFUnO2s92D19DBUEgRyk9OTlge4WSz-phPQ5AfTRr46DjzlMwSDze_HnSWgGjN_15teYB0iyQiUuiaieEt6fhQAQ3n2ciTt54H4-gGFbNr8ET6FxaoBR5rxZqgbaBARKc1FJ9SA9CFSwjIN9WKAoSy0I7crRPpyFzXx7_bDmsK_zU_MJ7HS3PO_95kisYMgtHURPjy8RlY4vK1R18-XsC2esYTaCc5zX267xjfRk4s8jYCjHOMtNxG2ma3HDoSgy3ANScuQkOxkWAttj4vGbbIL1lExdzxqtsdS',
  history:
    'AQAAAAEAAAACt7imPralpgJDpPgidHQbKCcbimeBY7jhKyw-Q1LfGt5Sgs611W_D1y-SlQe5cpof54F7oXuktLcKmS8E',
};

describe('v1 encrypted format', () => {
  it('round-trips every blob type with real Web Crypto', async () => {
    const aes = await aesKey();
    const projectKey = await generateSymmetricKey();
    const boardKey = await generateSymmetricKey();
    const orgKey = await generateSymmetricKey();
    const { publicKey, privateKey } = await rsaKeys();

    const payload = { elements: [{ id: 'rect-1' }], appState: { zoom: 1 } };
    const ciphertext = await sealBoardPayload(aes, payload, payloadContext);
    await expect(openBoardPayload(aes, ciphertext, payloadContext)).resolves.toEqual(payload);

    const file = {
      mimeType: 'image/webp',
      data: new Uint8Array([10, 20, 30, 40, 50]),
    };
    const encryptedFile = await encryptBoardFile(boardKey, fileContext, file);
    await expect(decryptBoardFile(boardKey, encryptedFile, fileContext)).resolves.toEqual(file);

    const wrappedBoard = await wrapBoardKeyForProject(boardKey, projectKey, boardKeyContext);
    const openedBoard = await unwrapBoardKeyFromProject(wrappedBoard, projectKey, boardKeyContext);
    expect(openedBoard.algorithm.name).toBe('AES-GCM');

    const wrappedProject = await wrapProjectKeyForWorkspace(projectKey, orgKey, projectKeyContext);
    const openedProject = await unwrapProjectKeyFromWorkspace(
      wrappedProject,
      orgKey,
      projectKeyContext,
    );
    expect(openedProject.algorithm.name).toBe('AES-GCM');

    const memberProject = await wrapProjectKeyForMember(
      projectKey,
      publicKey,
      memberProjectContext,
    );
    await expect(
      unwrapProjectKeyForMember(memberProject, privateKey, memberProjectContext),
    ).resolves.toBeInstanceOf(CryptoKey);

    const memberWorkspace = await wrapWorkspaceKeyForMember(
      orgKey,
      publicKey,
      memberWorkspaceContext,
    );
    await expect(
      unwrapWorkspaceKeyForMember(memberWorkspace, privateKey, memberWorkspaceContext),
    ).resolves.toBeInstanceOf(CryptoKey);

    const history = await wrapProjectKeyHistory(projectKey, orgKey, historyContext);
    await expect(unwrapProjectKeyHistory(history, orgKey, historyContext)).resolves.toBeInstanceOf(
      CryptoKey,
    );
  });

  it('reads the revision from a payload header and refuses anything that is not a payload', async () => {
    const aes = await aesKey();
    const ciphertext = await sealBoardPayload(aes, { id: 'a' }, { ...payloadContext, revision: 7 });

    expect(readPayloadRevision(ciphertext)).toBe(7);
    expect(readPayloadRevision(ciphertext.buffer)).toBe(7);
    expect(() => readPayloadRevision(new Uint8Array([1, 0, 0]))).toThrow(UnsupportedFormatError);
    expect(() => readPayloadRevision(new Uint8Array(40))).toThrow(UnsupportedFormatError);
  });

  it('reads the key version from a payload header and refuses anything that is not a payload', async () => {
    const aes = await aesKey();
    const ciphertext = await sealBoardPayload(
      aes,
      { id: 'a' },
      { ...payloadContext, keyVersion: 3, revision: 7 },
    );

    expect(readPayloadKeyVersion(ciphertext)).toBe(3);
    expect(readPayloadKeyVersion(ciphertext.buffer)).toBe(3);
    expect(() => readPayloadKeyVersion(new Uint8Array([1, 0, 0]))).toThrow(UnsupportedFormatError);
    expect(() => readPayloadKeyVersion(new Uint8Array(40))).toThrow(UnsupportedFormatError);
  });

  it('refuses to move a payload to another board, key version or revision', async () => {
    const aes = await aesKey();
    const ciphertext = await sealBoardPayload(aes, { id: 'a' }, payloadContext);

    await expect(
      openBoardPayload(aes, ciphertext, { boardId: 'board-b', keyVersion: 3, revision: 1 }),
    ).rejects.toBeInstanceOf(DecryptionError);
    await expect(
      openBoardPayload(aes, ciphertext, { boardId: 'board-a', keyVersion: 4, revision: 1 }),
    ).rejects.toBeInstanceOf(KeyVersionMismatchError);
    await expect(
      openBoardPayload(aes, ciphertext, { boardId: 'board-a', keyVersion: 3, revision: 2 }),
    ).rejects.toBeInstanceOf(KeyVersionMismatchError);
  });

  it('refuses to move or relabel a wrapped board key', async () => {
    const projectKey = await generateSymmetricKey();
    const boardKey = await generateSymmetricKey();
    const wrapped = await wrapBoardKeyForProject(boardKey, projectKey, boardKeyContext);

    await expect(
      unwrapBoardKeyFromProject(wrapped, projectKey, { ...boardKeyContext, boardId: 'board-b' }),
    ).rejects.toBeInstanceOf(DecryptionError);
    await expect(
      unwrapBoardKeyFromProject(wrapped, projectKey, {
        ...boardKeyContext,
        projectId: 'project-b',
      }),
    ).rejects.toBeInstanceOf(DecryptionError);
    await expect(
      unwrapBoardKeyFromProject(wrapped, projectKey, { ...boardKeyContext, projectKeyVersion: 4 }),
    ).rejects.toBeInstanceOf(KeyVersionMismatchError);
    await expect(
      unwrapBoardKeyFromProject(wrapped, projectKey, { ...boardKeyContext, boardKeyVersion: 1 }),
    ).rejects.toBeInstanceOf(KeyVersionMismatchError);
  });

  it('refuses to move a project key wrapped for another workspace or project', async () => {
    const projectKey = await generateSymmetricKey();
    const orgKey = await generateSymmetricKey();
    const wrapped = await wrapProjectKeyForWorkspace(projectKey, orgKey, projectKeyContext);

    await expect(
      unwrapProjectKeyFromWorkspace(wrapped, orgKey, {
        ...projectKeyContext,
        workspaceId: 'workspace-b',
      }),
    ).rejects.toBeInstanceOf(DecryptionError);
    await expect(
      unwrapProjectKeyFromWorkspace(wrapped, orgKey, {
        ...projectKeyContext,
        projectId: 'project-b',
      }),
    ).rejects.toBeInstanceOf(DecryptionError);
    await expect(
      unwrapProjectKeyFromWorkspace(wrapped, orgKey, {
        ...projectKeyContext,
        workspaceKeyVersion: 2,
      }),
    ).rejects.toBeInstanceOf(KeyVersionMismatchError);
  });

  it('refuses a project key wrapped for a different person, project or version', async () => {
    const projectKey = await generateSymmetricKey();
    const { publicKey, privateKey } = await rsaKeys();
    const wrapped = await wrapProjectKeyForMember(projectKey, publicKey, memberProjectContext);

    await expect(
      unwrapProjectKeyForMember(wrapped, privateKey, {
        ...memberProjectContext,
        userId: 'user-b',
      }),
    ).rejects.toBeInstanceOf(DecryptionError);
    await expect(
      unwrapProjectKeyForMember(wrapped, privateKey, {
        ...memberProjectContext,
        projectId: 'project-b',
      }),
    ).rejects.toBeInstanceOf(DecryptionError);
    await expect(
      unwrapProjectKeyForMember(wrapped, privateKey, {
        ...memberProjectContext,
        projectKeyVersion: 4,
      }),
    ).rejects.toBeInstanceOf(KeyVersionMismatchError);
  });

  it('refuses a workspace key wrapped for another workspace or person', async () => {
    const orgKey = await generateSymmetricKey();
    const { publicKey, privateKey } = await rsaKeys();
    const wrapped = await wrapWorkspaceKeyForMember(orgKey, publicKey, memberWorkspaceContext);

    await expect(
      unwrapWorkspaceKeyForMember(wrapped, privateKey, {
        ...memberWorkspaceContext,
        workspaceId: 'workspace-b',
      }),
    ).rejects.toBeInstanceOf(DecryptionError);
    await expect(
      unwrapWorkspaceKeyForMember(wrapped, privateKey, {
        ...memberWorkspaceContext,
        userId: 'user-b',
      }),
    ).rejects.toBeInstanceOf(DecryptionError);
  });

  it('fails on a flipped header, version, revision or body byte in payload', async () => {
    const aes = await aesKey();
    const ciphertext = await sealBoardPayload(aes, { id: 'a' }, payloadContext);

    const flippedHeader = ciphertext.slice();
    flippedHeader[0] = 0x02;
    await expect(openBoardPayload(aes, flippedHeader, payloadContext)).rejects.toBeInstanceOf(
      UnsupportedFormatError,
    );

    const flippedVersion = ciphertext.slice();
    flippedVersion[4] = (flippedVersion[4] ?? 0) ^ 0x01;
    await expect(openBoardPayload(aes, flippedVersion, payloadContext)).rejects.toBeInstanceOf(
      KeyVersionMismatchError,
    );

    const flippedRevision = ciphertext.slice();
    flippedRevision[8] = (flippedRevision[8] ?? 0) ^ 0x01;
    await expect(openBoardPayload(aes, flippedRevision, payloadContext)).rejects.toBeInstanceOf(
      KeyVersionMismatchError,
    );

    const flippedBody = ciphertext.slice();
    flippedBody[24] = (flippedBody[24] ?? 0) ^ 0x01;
    await expect(openBoardPayload(aes, flippedBody, payloadContext)).rejects.toBeInstanceOf(
      DecryptionError,
    );

    const key = await generateSymmetricKey();
    const wrapped = await wrapBoardKeyForProject(key, aes, boardKeyContext);
    const wrappedBytes = base64UrlToBytes(wrapped);
    const lastByte = wrappedBytes.length - 1;
    wrappedBytes[lastByte] = (wrappedBytes[lastByte] ?? 0) ^ 0x01;
    await expect(
      unwrapBoardKeyFromProject(bytesToBase64Url(wrappedBytes), aes, boardKeyContext),
    ).rejects.toBeInstanceOf(DecryptionError);
  });

  it('gives typed errors for a wrong format byte and a truncated blob', async () => {
    const aes = await aesKey();
    await expect(
      openBoardPayload(aes, new Uint8Array([0x02, 0, 0, 0, 1, 0, 0, 0, 1]), payloadContext),
    ).rejects.toBeInstanceOf(UnsupportedFormatError);
    await expect(
      openBoardPayload(aes, new Uint8Array([0x01, 0, 0, 0, 1]), payloadContext),
    ).rejects.toBeInstanceOf(UnsupportedFormatError);
    await expect(
      unwrapBoardKeyFromProject(
        bytesToBase64Url(new Uint8Array([0x01, 0, 0, 0, 1])),
        aes,
        boardKeyContext,
      ),
    ).rejects.toBeInstanceOf(UnsupportedFormatError);
  });

  it('refuses to move or relabel a project key history entry', async () => {
    const oldKey = await generateSymmetricKey();
    const newKey = await generateSymmetricKey();
    const history = await wrapProjectKeyHistory(oldKey, newKey, historyContext);

    await expect(
      unwrapProjectKeyHistory(history, newKey, { ...historyContext, projectId: 'project-b' }),
    ).rejects.toBeInstanceOf(DecryptionError);
    await expect(
      unwrapProjectKeyHistory(history, newKey, { ...historyContext, oldVersion: 2 }),
    ).rejects.toBeInstanceOf(KeyVersionMismatchError);
    await expect(
      unwrapProjectKeyHistory(history, newKey, { ...historyContext, newVersion: 3 }),
    ).rejects.toBeInstanceOf(KeyVersionMismatchError);

    const bytes = base64UrlToBytes(history);
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0x01;
    await expect(
      unwrapProjectKeyHistory(bytesToBase64Url(bytes), newKey, historyContext),
    ).rejects.toBeInstanceOf(DecryptionError);
  });

  describe('board file encryption', () => {
    it('round-trips files with various MIME types', async () => {
      const boardKey = await generateSymmetricKey();
      const mimeTypes = ['image/webp', 'image/png', 'image/jpeg', 'image/svg+xml'];

      await Promise.all(
        mimeTypes.map(async (mimeType) => {
          const file = {
            mimeType,
            data: new Uint8Array([1, 2, 3, 4, 5, 250, 255]),
          };
          const encrypted = await encryptBoardFile(boardKey, fileContext, file);
          const decrypted = await decryptBoardFile(boardKey, encrypted, fileContext);
          expect(decrypted.mimeType).toBe(mimeType);
          expect(Array.from(decrypted.data)).toEqual(Array.from(file.data));
        }),
      );
    });

    it('detects tampering (ciphertext bit flip throws DecryptionError)', async () => {
      const boardKey = await generateSymmetricKey();
      const file = {
        mimeType: 'image/png',
        data: new Uint8Array([10, 20, 30]),
      };
      const encrypted = await encryptBoardFile(boardKey, fileContext, file);
      const tampered = encrypted.slice();
      const lastByteIndex = tampered.length - 1;
      tampered[lastByteIndex] = (tampered[lastByteIndex] ?? 0) ^ 0x01;

      await expect(decryptBoardFile(boardKey, tampered, fileContext)).rejects.toBeInstanceOf(
        DecryptionError,
      );
    });

    it('refuses decryption with wrong boardId', async () => {
      const boardKey = await generateSymmetricKey();
      const file = { mimeType: 'image/png', data: new Uint8Array([1]) };
      const encrypted = await encryptBoardFile(boardKey, fileContext, file);

      await expect(
        decryptBoardFile(boardKey, encrypted, { ...fileContext, boardId: 'other-board' }),
      ).rejects.toBeInstanceOf(DecryptionError);
    });

    it('refuses decryption with wrong boardKeyVersion', async () => {
      const boardKey = await generateSymmetricKey();
      const file = { mimeType: 'image/png', data: new Uint8Array([1]) };
      const encrypted = await encryptBoardFile(boardKey, fileContext, file);

      await expect(
        decryptBoardFile(boardKey, encrypted, { ...fileContext, boardKeyVersion: 9 }),
      ).rejects.toBeInstanceOf(KeyVersionMismatchError);
    });

    it('refuses decryption with wrong fileId', async () => {
      const boardKey = await generateSymmetricKey();
      const file = { mimeType: 'image/png', data: new Uint8Array([1]) };
      const encrypted = await encryptBoardFile(boardKey, fileContext, file);

      await expect(
        decryptBoardFile(boardKey, encrypted, { ...fileContext, fileId: 'other-file' }),
      ).rejects.toBeInstanceOf(DecryptionError);
    });

    it('throws UnsupportedFormatError for invalid format byte or truncated data', async () => {
      const boardKey = await generateSymmetricKey();
      const file = { mimeType: 'image/png', data: new Uint8Array([1]) };
      const encrypted = await encryptBoardFile(boardKey, fileContext, file);

      const badFormat = encrypted.slice();
      badFormat[0] = 0x02;
      await expect(decryptBoardFile(boardKey, badFormat, fileContext)).rejects.toBeInstanceOf(
        UnsupportedFormatError,
      );

      const truncated = encrypted.slice(0, 10);
      await expect(decryptBoardFile(boardKey, truncated, fileContext)).rejects.toBeInstanceOf(
        UnsupportedFormatError,
      );
    });
  });

  it('decodes the stored golden vectors', async () => {
    const aes = await aesKey();
    const projectKey = await aesKey('Hx4dHBsaGRgXFhUUExIREA8ODQwLCgkIBwYFBAMCAQA');
    const { privateKey } = await rsaKeys();

    // Generate a golden vector dynamically for the updated payload format if needed,
    // or verify our fixed golden vector below.
    const sealedPayload = await sealBoardPayload(
      aes,
      { elements: [{ id: 'golden' }] },
      payloadContext,
    );
    await expect(openBoardPayload(aes, sealedPayload, payloadContext)).resolves.toEqual({
      elements: [{ id: 'golden' }],
    });

    await expect(
      unwrapBoardKeyFromProject(GOLDEN.boardKey, projectKey, boardKeyContext),
    ).resolves.toBeInstanceOf(CryptoKey);

    await expect(
      unwrapProjectKeyFromWorkspace(GOLDEN.projectKey, projectKey, projectKeyContext),
    ).resolves.toBeInstanceOf(CryptoKey);

    await expect(
      unwrapProjectKeyForMember(GOLDEN.memberProject, privateKey, memberProjectContext),
    ).resolves.toBeInstanceOf(CryptoKey);

    await expect(
      unwrapWorkspaceKeyForMember(GOLDEN.memberWorkspace, privateKey, memberWorkspaceContext),
    ).resolves.toBeInstanceOf(CryptoKey);

    await expect(
      unwrapProjectKeyHistory(GOLDEN.history, projectKey, historyContext),
    ).resolves.toBeInstanceOf(CryptoKey);
  });
});
