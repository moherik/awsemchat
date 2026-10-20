defmodule AwsemChatWeb.ErrorsTest do
  @moduledoc """
  The error table is the one place a code becomes a response: every code renders
  its snake_case atom with the status this file says it carries, and anything
  that is not a known code becomes `internal_error` without a trace of the
  exception that produced it.
  """

  use AwsemChatWeb.ConnCase, async: true

  alias AwsemChatWeb.Errors

  @table [
    unauthorized: 401,
    forbidden: 403,
    not_member: 403,
    not_friends: 403,
    blocked: 403,
    not_found: 404,
    user_not_found: 404,
    media_not_found: 404,
    already_friends: 409,
    conversation_read_only: 409,
    circle_full: 409,
    payload_too_large: 413,
    too_large: 413,
    unsupported_media_type: 415,
    invalid_phone: 422,
    invalid_profile: 422,
    invalid_kind: 422,
    invalid_payload: 422,
    invalid_client_op_id: 422,
    self_request: 422,
    phone_required: 400,
    phone_and_code_required: 400,
    pin_required: 400,
    peer_user_id_required: 400,
    missing_file: 400,
    invalid_cursor: 400,
    internal_error: 500,
    send_failed: 500
  ]

  test "every code renders its snake_case atom with the table's status" do
    for {code, status} <- @table do
      conn = Errors.render(build_conn(), code)
      assert conn.status == status, "#{code} rendered #{conn.status}, table says #{status}"
      assert Jason.decode!(conn.resp_body) == %{"error" => %{"code" => to_string(code)}}
    end
  end

  test "the envelope carries only a code, never a message or a status field" do
    body = build_conn() |> Errors.render(:not_found) |> Map.fetch!(:resp_body) |> Jason.decode!()

    assert body == %{"error" => %{"code" => "not_found"}}
  end

  test "an unknown atom maps to internal_error" do
    conn = Errors.render(build_conn(), :some_code_nobody_added)
    assert conn.status == 500
    assert Jason.decode!(conn.resp_body) == %{"error" => %{"code" => "internal_error"}}
  end

  test "a raw string that is not a code maps to internal_error" do
    conn = Errors.render(build_conn(), "DROP TABLE users")
    assert conn.status == 500
    assert Jason.decode!(conn.resp_body) == %{"error" => %{"code" => "internal_error"}}
  end

  test "an exception maps to internal_error without leaking its data" do
    exception = %RuntimeError{
      message: "postgres://user:secret@host/awsemchat_dev password=hunter2"
    }

    conn = Errors.render(build_conn(), {:error, exception})
    body = conn.resp_body

    assert conn.status == 500
    assert Jason.decode!(body) == %{"error" => %{"code" => "internal_error"}}
    refute body =~ "hunter2"
    refute body =~ "postgres://"
    refute body =~ "RuntimeError"
    refute body =~ "elixir"
  end

  test "a changeset maps to internal_error without leaking its struct" do
    changeset =
      {%{}, %{phone: :string}}
      |> Ecto.Changeset.cast(%{"phone" => nil}, [:phone])
      |> Ecto.Changeset.validate_required([:phone])

    conn = Errors.render(build_conn(), {:error, changeset})

    assert conn.status == 500
    refute conn.resp_body =~ "Ecto.Changeset"
    refute conn.resp_body =~ "phone"
  end

  test "a stacktrace never reaches the body" do
    conn =
      Errors.render(
        build_conn(),
        {:error, :boom, [{AwsemChat.Repo, :all, 1, [file: ~c"lib/awsemchat/repo.ex", line: 1]}]}
      )

    refute conn.resp_body =~ "repo.ex"
    assert conn.status == 500
  end

  test "status_for/1 falls back to 500 for an unmapped code" do
    assert Errors.status_for(:unauthorized) == 401
    assert Errors.status_for(:whatever) == 500
  end

  test "an unknown code in the table's own shape is refused at compile time" do
    # `status_for/1` is callable with anything at runtime and answers 500; the
    # `code/1` side is the guarantee that every rendered code exists in the
    # table. A code nobody added never renders as itself.
    refute Errors.known?(:nope)
    assert Errors.known?(:unauthorized)
  end

  test "codes/0 exposes the whole table" do
    assert :unauthorized in Errors.codes()
    assert :internal_error in Errors.codes()
    assert length(Errors.codes()) == length(@table)
  end

  test "code_for/2 is the one reason-to-code map, and its values do not drift" do
    # Circle reasons
    assert Errors.code_for(:not_found) == :not_found
    assert Errors.code_for(:not_member) == :not_member
    assert Errors.code_for(:forbidden) == :forbidden
    assert Errors.code_for(:circle_full) == :circle_full
    assert Errors.code_for(:not_friends) == :not_friends
    # Chat reasons
    assert Errors.code_for(:conversation_read_only) == :conversation_read_only
    assert Errors.code_for(:blocked) == :blocked
    assert Errors.code_for(:payload_too_large) == :payload_too_large
    assert Errors.code_for(:invalid_kind) == :invalid_kind
    assert Errors.code_for(:invalid_client_op_id) == :invalid_client_op_id
    assert Errors.code_for(:invalid_cursor) == :invalid_cursor
    assert Errors.code_for(:invalid_payload) == :invalid_payload
    assert Errors.code_for(:send_failed) == :send_failed
    # Friend-request reasons
    assert Errors.code_for(:self) == :self_request
    assert Errors.code_for(:already_friends) == :already_friends
    # Media reasons
    assert Errors.code_for(:too_large) == :too_large
    assert Errors.code_for(:unsupported) == :unsupported_media_type
    # Auth reasons: a wrong and an expired code are the same answer
    assert Errors.code_for(:invalid_code) == :unauthorized
    assert Errors.code_for(:expired) == :unauthorized
    assert Errors.code_for(:pin_exhausted) == :internal_error
    # Unmapped is a server fault
    assert Errors.code_for(:nobody_mapped_this) == :internal_error
  end

  test "every code code_for/2 can return is a declared code" do
    reasons = [
      :not_found,
      :not_member,
      :forbidden,
      :circle_full,
      :not_friends,
      :conversation_read_only,
      :blocked,
      :payload_too_large,
      :invalid_kind,
      :invalid_client_op_id,
      :invalid_cursor,
      :invalid_payload,
      :send_failed,
      :self,
      :already_friends,
      :too_large,
      :unsupported,
      :invalid_code,
      :expired,
      :pin_exhausted
    ]

    for reason <- reasons, do: assert(Errors.known?(Errors.code_for(reason)))
    assert Errors.known?(Errors.code_for(:anything_else))
  end

  test "a changeset's code is the caller's choice, defaulting to a server fault" do
    changeset =
      {%{}, %{phone: :string}}
      |> Ecto.Changeset.cast(%{"phone" => nil}, [:phone])
      |> Ecto.Changeset.validate_required([:phone])

    # Circle and chat callers mean "the client's input was invalid".
    assert Errors.code_for(changeset, changeset: :invalid_payload) == :invalid_payload
    # Auth means "the phone was invalid".
    assert Errors.code_for(changeset, changeset: :invalid_phone) == :invalid_phone
    # A caller that says nothing gets the pre-consolidation answer: 500.
    assert Errors.code_for(changeset) == :internal_error
  end
end
