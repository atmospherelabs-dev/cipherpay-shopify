const PAYMENTS_API_VERSION = '2026-01';

function paymentsApiUrl(shop: string): string {
  return `https://${shop}/payments_apps/api/${PAYMENTS_API_VERSION}/graphql.json`;
}

async function paymentsGraphQL(
  shop: string,
  accessToken: string,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const res = await fetch(paymentsApiUrl(shop), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Payments API error ${res.status}: ${text}`);
  }

  const json = await res.json();

  if (json.errors?.length) {
    throw new Error(`Payments API GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data;
}

// --- Payment Sessions ---

export async function paymentSessionResolve(
  shop: string,
  accessToken: string,
  paymentSessionGid: string,
  authorizationExpiresAt?: string
): Promise<void> {
  const query = `
    mutation PaymentSessionResolve($id: ID!, $authorizationExpiresAt: DateTime) {
      paymentSessionResolve(id: $id, authorizationExpiresAt: $authorizationExpiresAt) {
        paymentSession {
          id
          state {
            code
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await paymentsGraphQL(shop, accessToken, query, {
    id: paymentSessionGid,
    authorizationExpiresAt,
  }) as { paymentSessionResolve: { userErrors: Array<{ field: string; message: string }> } };

  const errors = data.paymentSessionResolve?.userErrors;
  if (errors?.length) {
    throw new Error(`paymentSessionResolve errors: ${JSON.stringify(errors)}`);
  }
}

export async function paymentSessionReject(
  shop: string,
  accessToken: string,
  paymentSessionGid: string,
  reason: string
): Promise<void> {
  const query = `
    mutation PaymentSessionReject($id: ID!, $reason: PaymentSessionRejectionReasonInput!) {
      paymentSessionReject(id: $id, reason: $reason) {
        paymentSession {
          id
          state {
            code
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await paymentsGraphQL(shop, accessToken, query, {
    id: paymentSessionGid,
    reason: { code: 'PROCESSING_ERROR', merchantMessage: reason },
  }) as { paymentSessionReject: { userErrors: Array<{ field: string; message: string }> } };

  const errors = data.paymentSessionReject?.userErrors;
  if (errors?.length) {
    throw new Error(`paymentSessionReject errors: ${JSON.stringify(errors)}`);
  }
}

export async function paymentSessionPending(
  shop: string,
  accessToken: string,
  paymentSessionGid: string,
  pendingExpiresAt: string
): Promise<void> {
  const query = `
    mutation PaymentSessionPending($id: ID!, $pendingExpiresAt: DateTime!) {
      paymentSessionPending(id: $id, pendingExpiresAt: $pendingExpiresAt) {
        paymentSession {
          id
          state {
            code
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await paymentsGraphQL(shop, accessToken, query, {
    id: paymentSessionGid,
    pendingExpiresAt,
  }) as { paymentSessionPending: { userErrors: Array<{ field: string; message: string }> } };

  const errors = data.paymentSessionPending?.userErrors;
  if (errors?.length) {
    throw new Error(`paymentSessionPending errors: ${JSON.stringify(errors)}`);
  }
}

// --- Refund Sessions ---

export async function refundSessionResolve(
  shop: string,
  accessToken: string,
  refundSessionGid: string
): Promise<void> {
  const query = `
    mutation RefundSessionResolve($id: ID!) {
      refundSessionResolve(id: $id) {
        refundSession {
          id
          state {
            code
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await paymentsGraphQL(shop, accessToken, query, {
    id: refundSessionGid,
  }) as { refundSessionResolve: { userErrors: Array<{ field: string; message: string }> } };

  const errors = data.refundSessionResolve?.userErrors;
  if (errors?.length) {
    throw new Error(`refundSessionResolve errors: ${JSON.stringify(errors)}`);
  }
}

export async function refundSessionReject(
  shop: string,
  accessToken: string,
  refundSessionGid: string,
  reason: string
): Promise<void> {
  const query = `
    mutation RefundSessionReject($id: ID!, $reason: RefundSessionRejectionReasonInput!) {
      refundSessionReject(id: $id, reason: $reason) {
        refundSession {
          id
          state {
            code
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await paymentsGraphQL(shop, accessToken, query, {
    id: refundSessionGid,
    reason: { code: 'PROCESSING_ERROR', merchantMessage: reason },
  }) as { refundSessionReject: { userErrors: Array<{ field: string; message: string }> } };

  const errors = data.refundSessionReject?.userErrors;
  if (errors?.length) {
    throw new Error(`refundSessionReject errors: ${JSON.stringify(errors)}`);
  }
}

// --- Capture Sessions ---

export async function captureSessionResolve(
  shop: string,
  accessToken: string,
  captureSessionGid: string
): Promise<void> {
  const query = `
    mutation CaptureSessionResolve($id: ID!) {
      captureSessionResolve(id: $id) {
        captureSession {
          id
          state {
            code
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await paymentsGraphQL(shop, accessToken, query, {
    id: captureSessionGid,
  }) as { captureSessionResolve: { userErrors: Array<{ field: string; message: string }> } };

  const errors = data.captureSessionResolve?.userErrors;
  if (errors?.length) {
    throw new Error(`captureSessionResolve errors: ${JSON.stringify(errors)}`);
  }
}

export async function captureSessionReject(
  shop: string,
  accessToken: string,
  captureSessionGid: string,
  reason: string
): Promise<void> {
  const query = `
    mutation CaptureSessionReject($id: ID!, $reason: CaptureSessionRejectionReasonInput!) {
      captureSessionReject(id: $id, reason: $reason) {
        captureSession {
          id
          state {
            code
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await paymentsGraphQL(shop, accessToken, query, {
    id: captureSessionGid,
    reason: { code: 'PROCESSING_ERROR', merchantMessage: reason },
  }) as { captureSessionReject: { userErrors: Array<{ field: string; message: string }> } };

  const errors = data.captureSessionReject?.userErrors;
  if (errors?.length) {
    throw new Error(`captureSessionReject errors: ${JSON.stringify(errors)}`);
  }
}

// --- Void Sessions ---

export async function voidSessionResolve(
  shop: string,
  accessToken: string,
  voidSessionGid: string
): Promise<void> {
  const query = `
    mutation VoidSessionResolve($id: ID!) {
      voidSessionResolve(id: $id) {
        voidSession {
          id
          state {
            code
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await paymentsGraphQL(shop, accessToken, query, {
    id: voidSessionGid,
  }) as { voidSessionResolve: { userErrors: Array<{ field: string; message: string }> } };

  const errors = data.voidSessionResolve?.userErrors;
  if (errors?.length) {
    throw new Error(`voidSessionResolve errors: ${JSON.stringify(errors)}`);
  }
}

export async function voidSessionReject(
  shop: string,
  accessToken: string,
  voidSessionGid: string,
  reason: string
): Promise<void> {
  const query = `
    mutation VoidSessionReject($id: ID!, $reason: VoidSessionRejectionReasonInput!) {
      voidSessionReject(id: $id, reason: $reason) {
        voidSession {
          id
          state {
            code
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await paymentsGraphQL(shop, accessToken, query, {
    id: voidSessionGid,
    reason: { code: 'PROCESSING_ERROR', merchantMessage: reason },
  }) as { voidSessionReject: { userErrors: Array<{ field: string; message: string }> } };

  const errors = data.voidSessionReject?.userErrors;
  if (errors?.length) {
    throw new Error(`voidSessionReject errors: ${JSON.stringify(errors)}`);
  }
}

// --- App Configuration ---

export async function paymentsAppConfigure(
  shop: string,
  accessToken: string,
  externalHandle: string,
  ready: boolean
): Promise<void> {
  const query = `
    mutation PaymentsAppConfigure($externalHandle: String, $ready: Boolean!) {
      paymentsAppConfigure(externalHandle: $externalHandle, ready: $ready) {
        paymentsAppConfiguration {
          externalHandle
          ready
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await paymentsGraphQL(shop, accessToken, query, {
    externalHandle,
    ready,
  }) as { paymentsAppConfigure: { userErrors: Array<{ field: string; message: string }> } };

  const errors = data.paymentsAppConfigure?.userErrors;
  if (errors?.length) {
    throw new Error(`paymentsAppConfigure errors: ${JSON.stringify(errors)}`);
  }
}
