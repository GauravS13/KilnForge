export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB

export class UploadTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`upload exceeds the ${maxBytes}-byte limit`);
    this.name = "UploadTooLargeError";
  }
}

/**
 * Reads a request's multipart body as FormData, enforcing a hard byte cap
 * on the actual bytes received — not just trusting the Content-Length
 * header, since that can be absent or understated (chunked encoding).
 * Rejects fast on a Content-Length that already declares over the limit;
 * otherwise streams and counts, erroring the stream the moment the real
 * byte count crosses the cap rather than buffering the whole body first.
 */
export async function readLimitedFormData(
  req: Request,
  maxBytes = MAX_UPLOAD_BYTES,
): Promise<FormData> {
  const declaredLength = req.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > maxBytes) {
    throw new UploadTooLargeError(maxBytes);
  }
  if (!req.body) {
    throw new Error("request has no body");
  }

  let received = 0;
  const limited = req.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > maxBytes) {
          controller.error(new UploadTooLargeError(maxBytes));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );

  const wrapped = new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body: limited,
    // @ts-expect-error — duplex is required for a streaming body but not
    // yet in the shared lib.dom.d.ts RequestInit type Bun's types extend.
    duplex: "half",
  });

  return await wrapped.formData();
}

export async function readImageField(formData: FormData, fieldName: string): Promise<Uint8Array> {
  const file = formData.get(fieldName);
  if (!(file instanceof File)) {
    throw new Error(`missing or invalid "${fieldName}" field — expected a file upload`);
  }
  return new Uint8Array(await file.arrayBuffer());
}
