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

  @doc "Every code the table declares, in no particular order."
  def codes, do: @codes

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
