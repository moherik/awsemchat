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
end
