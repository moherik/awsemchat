defmodule AwsemChatWeb.Errors do
  @moduledoc """
  The error table: every API code, the HTTP status it carries, and the one
  function that writes the envelope.

  ## Why a table

  A code is a contract with the client. When each controller spells its own
  `put_status` and its own code, the two drift: the same code leaves as 403 from
  one action and 401 from another, or a new action invents a code the client has
  never seen. Here every code is declared once next to its status, and
  `render/2` is the only way an error leaves the API. Adding a code means adding
  a row here, so the set of codes the client must handle is readable in one
  place.

  ## Two halves: the reason a context returns, the code the client sees

  A context returns a reason from its own vocabulary (`{:error, :not_member}`),
  and the client reads a code (`not_member`). The status table above holds the
  code half. The reason half is `code_for/2`: one map from reason to code, shared
  by every controller, so a reason that means the same thing in two contexts
  cannot become two codes. A controller's job is `Errors.render(conn,
  Errors.code_for(reason))` and nothing else — no per-controller `foo_error/1`
  clause list to keep in step with the others.

  ## The envelope

      {"error": {"code": "not_member"}}

  Only the code travels. No message, no status field, no identifier: the design
  doc's envelope carries a `code` the UI maps to a snackbar or an empty state,
  and the client is the right place for human text. A code the table does not
  know is `internal_error` with status 500, and nothing about the error that
  produced it is echoed back.

  ## Internal errors do not leak

  `render/2` accepts any reason at all and never inspects it beyond a table
  lookup. An exception, a changeset, a stacktrace, a bare atom nobody declared:
  each either matches a row or becomes `internal_error`. The response body is
  built from the code alone, so an exception's message, a changeset's struct, or
  a Postgres connection string inside a failure reason cannot reach the client.

  Routers, plugs, and controllers all render through here. Phoenix's own
  framework errors (a 404 for an unrouted path) keep their default shape via
  `AwsemChatWeb.ErrorJSON.render/2`; the API code paths here are what a client
  parses with its code mapper.
  """

  import Plug.Conn
  import Phoenix.Controller, only: [json: 2]

  # code => HTTP status. The status is part of the contract, so it lives next to
  # the code rather than at the call site. Grouped by status for reading.
  @statuses %{
    # 400 — the request is malformed or a required field is absent
    phone_required: 400,
    phone_and_code_required: 400,
    pin_required: 400,
    peer_user_id_required: 400,
    missing_file: 400,
    invalid_cursor: 400,
    # 401 — no session, or a token that is dead or unknown
    unauthorized: 401,
    # 403 — a real account, known to us, refused by a rule
    forbidden: 403,
    not_member: 403,
    not_friends: 403,
    blocked: 403,
    # 404 — the thing addressed does not exist (or is not yours to see)
    not_found: 404,
    user_not_found: 404,
    media_not_found: 404,
    # 409 — the request is well-formed but the current state refuses it
    already_friends: 409,
    conversation_read_only: 409,
    circle_full: 409,
    # 413/415 — the body itself is unacceptable
    payload_too_large: 413,
    too_large: 413,
    unsupported_media_type: 415,
    # 422 — parsed and understood, but a field fails validation
    invalid_phone: 422,
    invalid_profile: 422,
    invalid_kind: 422,
    invalid_payload: 422,
    invalid_client_op_id: 422,
    self_request: 422,
    # 500 — the server failed, or a code that was never declared
    internal_error: 500,
    send_failed: 500
  }

  @codes Map.keys(@statuses)
  @internal :internal_error

  # reason => code. The context's reason vocabulary, gathered in one place so a
  # reason that means the same thing in two controllers cannot become two
  # different codes. A reason the table has not mapped falls through to
  # `internal_error`: an unmapped reason is a server fault, not a client mistake.
  #
  # `:invalid_code`/`:expired` both become `unauthorized` on purpose — the client
  # must not be able to tell which one happened, the same rule the auth moduledoc
  # states. `:pin_exhausted` is listed only to say, explicitly, that it is a
  # server fault and not a 422 like the other auth changesets.
  @reasons %{
    # circle
    not_found: :not_found,
    not_member: :not_member,
    forbidden: :forbidden,
    circle_full: :circle_full,
    not_friends: :not_friends,
    # chat
    conversation_read_only: :conversation_read_only,
    blocked: :blocked,
    payload_too_large: :payload_too_large,
    invalid_kind: :invalid_kind,
    invalid_client_op_id: :invalid_client_op_id,
    invalid_cursor: :invalid_cursor,
    invalid_payload: :invalid_payload,
    send_failed: :send_failed,
    # friends
    self: :self_request,
    already_friends: :already_friends,
    # media
    too_large: :too_large,
    unsupported: :unsupported_media_type,
    # auth
    invalid_code: :unauthorized,
    expired: :unauthorized,
    pin_exhausted: :internal_error
  }

  @doc "Every code the table declares, in no particular order."
  def codes, do: @codes

  @doc """
  The code a context reason becomes, the single mapping every controller reads.

  An atom in `@reasons` maps to its code. A reason nobody mapped — an exception,
  an unmapped atom, a bare term — is `:internal_error`, because a reason nobody
  mapped is a fault of ours.

  A changeset means different things to different contexts: an invalid circle or
  message is the client's input failing validation (a 422), while a media row
  that will not insert is a fault of ours. So the changeset code is not baked in
  here: a caller that means "the client's input was invalid" passes
  `changeset: :invalid_payload` (or `:invalid_phone`), and a caller that does not
  gets `:internal_error`, the same answer it gave before this mapping moved out
  of the controllers.
  """
  def code_for(reason, opts \\ [])

  def code_for(%Ecto.Changeset{}, opts), do: Keyword.get(opts, :changeset, @internal)

  def code_for(reason, _opts) when is_atom(reason),
    do: Map.get(@reasons, reason, @internal)

  def code_for(_reason, _opts), do: @internal

  @doc "Whether `code` is a declared code."
  def known?(code), do: Map.has_key?(@statuses, code)

  @doc "The status for `code`, or 500 for a code the table does not know."
  def status_for(code), do: Map.get(@statuses, code, 500)

  @doc """
  Renders the error envelope for `code` and puts the table's status on the conn.

  `code` may be an atom (a declared code, or one nobody added) or any other
  term; anything not declared becomes `internal_error` with status 500, and the
  term itself is never written to the body.
  """
  def render(conn, code) do
    {status, code} = resolve(code)

    conn
    |> put_status(status)
    |> json(%{error: %{code: to_string(code)}})
  end

  defp resolve(code) do
    if known?(code) do
      {status_for(code), code}
    else
      {status_for(@internal), @internal}
    end
  end
end
