/** Thrown (as the `cause` of a FORBIDDEN TRPCError) when RBAC refuses a call. The error formatter turns it into
 *  `data.rbacDenied: true` so the client can tell it apart from "sign in with an @amnex.com account". */
export class RbacDenial extends Error {
  constructor(message: string, readonly detail: { module: string; action: string; atom?: string }) {
    super(message)
    this.name = 'RbacDenial'
  }
}

/** Thrown by a registry requirement when the input itself cannot be authorised (e.g. an unsupported `entityType`). */
export class DenyCall extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DenyCall'
  }
}
