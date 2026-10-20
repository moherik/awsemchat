defmodule AwsemChatWeb.ReactionsControllerTest do
  @moduledoc """
  The reaction routes' success paths and authorization failures, pinned for the
  first HTTP surface. Visibility is the context's rule (membership plus the
  circle join boundary); this proves the controller and error table agree.
  """

  use AwsemChatWeb.ConnCase, async: true

  alias AwsemChat.Accounts
  alias AwsemChat.Chat
  alias AwsemChat.Circles
  alias AwsemChat.Social

  setup do
    alice = create_user("+15550012001")
    bob = create_user("+15550012002")
    carol = create_user("+15550012003")

    {:ok, request} = Social.request_by_pin(alice, bob.pin)
    {:ok, _} = Social.respond(bob, request.id, :accept)
    {:ok, conversation} = Social.private_conversation(alice, bob)

    {:ok, message} =
      Chat.send_message(alice, conversation.id, %{
        clientOpId: Ecto.UUID.generate(),
        kind: :text,
        payload: %{"v" => 1, "text" => "hi"}
      })

    %{alice: alice, bob: bob, carol: carol, conversation: conversation, message: message}
  end

  test "PUT /api/v1/reactions/:targetType/:targetId sets a reaction", %{
    alice: alice,
    message: message
  } do
    body =
      build_conn()
      |> authenticate(alice.token)
      |> put("/api/v1/reactions/message/#{message.id}", %{"emoji" => "👍"})
      |> json_response(200)

    assert body["reaction"]["targetType"] == "message"
    assert body["reaction"]["targetId"] == message.id
    assert body["reaction"]["emoji"] == "👍"
    assert body["reaction"]["userId"] == alice.id
  end

  test "PUT on a target the caller cannot see is 404 not_found", %{
    carol: carol,
    message: message
  } do
    body =
      build_conn()
      |> authenticate(carol.token)
      |> put("/api/v1/reactions/message/#{message.id}", %{"emoji" => "👍"})
      |> json_response(404)

    assert body == %{"error" => %{"code" => "not_found"}}
  end

  test "DELETE /api/v1/reactions/:targetType/:targetId clears the caller's reaction", %{
    alice: alice,
    message: message
  } do
    build_conn()
    |> authenticate(alice.token)
    |> put("/api/v1/reactions/message/#{message.id}", %{"emoji" => "👍"})
    |> json_response(200)

    body =
      build_conn()
      |> authenticate(alice.token)
      |> delete("/api/v1/reactions/message/#{message.id}")
      |> json_response(200)

    assert body == %{}

    aggregates =
      build_conn()
      |> authenticate(alice.token)
      |> get("/api/v1/reactions/message?ids=#{message.id}")
      |> json_response(200)

    assert aggregates["reactions"] == %{}
  end

  test "GET /api/v1/reactions/:targetType lists aggregates the caller may see", %{
    alice: alice,
    bob: bob,
    message: message
  } do
    build_conn()
    |> authenticate(alice.token)
    |> put("/api/v1/reactions/message/#{message.id}", %{"emoji" => "👍"})
    |> json_response(200)

    body =
      build_conn()
      |> authenticate(bob.token)
      |> get("/api/v1/reactions/message?ids=#{message.id}")
      |> json_response(200)

    assert body["reactions"][message.id] == [%{"emoji" => "👍", "userId" => alice.id}]
  end

  test "GET on a target the caller cannot see omits it from the aggregates", %{
    carol: carol,
    alice: alice,
    message: message
  } do
    build_conn()
    |> authenticate(alice.token)
    |> put("/api/v1/reactions/message/#{message.id}", %{"emoji" => "👍"})
    |> json_response(200)

    body =
      build_conn()
      |> authenticate(carol.token)
      |> get("/api/v1/reactions/message?ids=#{message.id}")
      |> json_response(200)

    assert body["reactions"] == %{}
  end

  test "a late joiner cannot react to a prejoin message over HTTP", %{alice: alice, bob: bob} do
    {:ok, circle} = Circles.create(alice, %{name: "Squad"})

    {:ok, prejoin} =
      Chat.send_message(alice, circle.id, %{
        clientOpId: Ecto.UUID.generate(),
        kind: :text,
        payload: %{"v" => 1, "text" => "pre"}
      })

    {:ok, _} = Circles.invite(alice, circle.id, [bob.id])
    invitation = fetch_invitation(circle.id, bob.id)
    {:ok, _} = Circles.respond(bob, invitation.id, :accept)

    body =
      build_conn()
      |> authenticate(bob.token)
      |> put("/api/v1/reactions/message/#{prejoin.id}", %{"emoji" => "👍"})
      |> json_response(404)

    assert body == %{"error" => %{"code" => "not_found"}}
  end

  test "every reaction route behind Auth answers 401 unauthorized without a token" do
    for {method, path, params} <- [
          {:put, "/api/v1/reactions/message/#{Ecto.UUID.generate()}", %{"emoji" => "👍"}},
          {:delete, "/api/v1/reactions/message/#{Ecto.UUID.generate()}", nil},
          {:get, "/api/v1/reactions/message?ids=#{Ecto.UUID.generate()}", nil}
        ] do
      conn = Phoenix.ConnTest.dispatch(build_conn(), AwsemChatWeb.Endpoint, method, path, params)
      assert json_response(conn, 401) == %{"error" => %{"code" => "unauthorized"}}
    end
  end

  defp fetch_invitation(circle_id, invitee_id) do
    AwsemChat.Repo.get_by!(AwsemChat.Chat.CircleInvitation,
      circle_id: circle_id,
      invitee_id: invitee_id
    )
  end

  defp authenticate(conn, token) do
    put_req_header(conn, "authorization", "Bearer #{token}")
  end

  defp create_user(phone) do
    {:ok, _} = Accounts.request_code(phone)
    {:ok, %{user: user, token: token}} = Accounts.verify_code(phone, "123456")
    Map.put(user, :token, token)
  end
end
