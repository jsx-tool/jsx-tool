export function ieeeP1363ToDer (ieeeSignature: string): string {
  const signature = Buffer.from(ieeeSignature, 'base64');

  if (signature.length !== 64) {
    throw new Error(`Invalid signature length: ${signature.length}. Expected 64 bytes for P-256.`);
  }

  const r = signature.slice(0, 32);
  const s = signature.slice(32, 64);

  const der = encodeDER(r, s);
  return der.toString('base64');
}

export function derToIeeeP1363 (derSignature: string): string {
  const der = Buffer.from(derSignature, 'base64');
  const { r, s } = decodeDER(der);

  const rPadded = Buffer.concat([Buffer.alloc(32 - r.length), r], 32);
  const sPadded = Buffer.concat([Buffer.alloc(32 - s.length), s], 32);

  const ieee = Buffer.concat([rPadded, sPadded]);
  return ieee.toString('base64');
}

function encodeDER (r: Buffer, s: Buffer): Buffer {
  function trimInteger (buf: Buffer): Buffer {
    let i = 0;
    while (i < buf.length - 1 && buf[i] === 0 && !(buf[i + 1] & 0x80)) {
      i++;
    }
    return buf.slice(i);
  }

  const rTrimmed = trimInteger(r);
  const sTrimmed = trimInteger(s);

  const rEncoded = (rTrimmed[0] & 0x80) ? Buffer.concat([Buffer.from([0]), rTrimmed]) : rTrimmed;
  const sEncoded = (sTrimmed[0] & 0x80) ? Buffer.concat([Buffer.from([0]), sTrimmed]) : sTrimmed;

  const sequence = Buffer.concat([
    Buffer.from([0x02, rEncoded.length]),
    rEncoded,
    Buffer.from([0x02, sEncoded.length]),
    sEncoded
  ]);

  return Buffer.concat([
    Buffer.from([0x30, sequence.length]),
    sequence
  ]);
}

function decodeDER (der: Buffer): { r: Buffer, s: Buffer } {
  let offset = 0;

  if (der[offset++] !== 0x30) {
    throw new Error('Invalid DER format: expected SEQUENCE');
  }

  const seqLength = der[offset++];
  if (seqLength & 0x80) {
    throw new Error('Long form DER length not supported');
  }

  if (der[offset++] !== 0x02) {
    throw new Error('Invalid DER format: expected INTEGER for r');
  }
  const rLength = der[offset++];
  const r = der.slice(offset, offset + rLength);
  offset += rLength;

  if (der[offset++] !== 0x02) {
    throw new Error('Invalid DER format: expected INTEGER for s');
  }
  const sLength = der[offset++];
  const s = der.slice(offset, offset + sLength);

  return { r, s };
}
