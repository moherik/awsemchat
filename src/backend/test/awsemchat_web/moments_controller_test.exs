defmodule AwsemChatWeb.MomentsControllerTest do
  @moduledoc """
  The moment routes' success paths and authorization failures. Moments have no
  HTTP surface before this pass, so each route is pinned here: the context rules
  (audience boundary, author-only promote/delete) were tested directly, and this
  file proves the thin controller and the error table agree with them.
  """

  use AwsemChatWeb.ConnCase, async: true

  alias AwsemChat.Accounts
  alias AwsemChat.Chat
  alias AwsemChat.Circles
  alias AwsemChat.Moments
  alias AwsemChat.Social

  setup do
    alice = create_user("+15550011001")
    bob = create_user("+15550011002")
    carol = create_user("+15550011003")

    {:ok, request} = Social.request_by_pin(alice, bob.pin)
    {:ok, _} = Social.respond(bob, request.id, :accept)
    {:ok, conversation} = Social.private_conversation(alice, bob)

    %{alice: alice, bob: bob, carol: carol, conversation: conversation}
  end

  test "POST /api/v1/conversations/:id/moments creates a moment", %{
    alice: alice,
    conversation: conversation
  } do
    body =
      build_conn()
      |> authenticate(alice.token)
      |> post("/api/v1/conversations/#{conversation.id}/moments", %{
        "kind" => "text",
        "payload" => %{"v" => 1, "text" => "My moment"}
      })
      |> json_response(201)

    assert body["moment"]["conversationId"] == conversation.id
    assert body["moment"]["authorId"] == alice.id
    assert body["moment"]["kind"] == "text"
    assert body["moment"]["payload"] == %{"v" => 1, "text" => "My moment"}
    assert is_binary(body["moment"]["createdAt"])
  end

  test "POST /api/v1/conversations/:id/moments by a non-participant is 403 not_member", %{
    carol: carol,
    conversation: conversation
  } do
    body =
      build_conn()
      |> authenticate(carol.token)
      |> post("/api/v1/conversations/#{conversation.id}/moments", %{
        "kind" => "text",
        "payload" => %{"v" => 1}
      })
      |> json_response(403)

    assert body == %{"error" => %{"code" => "not_member"}}
  end

  test "POST /api/v1/conversations/:id/moments on an unknown conversation is 404", %{
    alice: alice
  } do
    body =
      build_conn()
      |> authenticate(alice.token)
      |> post("/api/v1/conversations/#{Ecto.UUID.generate()}/moments", %{
        "kind" => "text",
        "payload" => %{"v" => 1}
      })
      |> json_response(404)

    assert body == %{"error" => %{"code" => "not_found"}}
  end

  test "GET /api/v1/conversations/:id/moments lists them for a participant", %{
    alice: alice,
    conversation: conversation
  } do
    {:ok, moment} =
      Moments.create(alice, conversation.id, %{kind: :text, payload: %{"v" => 1, "text" => "m"}})

    body =
      build_conn()
      |> authenticate(alice.token)
      |> get("/api/v1/conversations/#{conversation.id}/moments")
      |> json_response(200)

    assert Enum.any?(body["moments"], &(&1["id"] == moment.id))
    assert body["nextCursor"] == nil
  end

  test "GET /api/v1/conversations/:id/moments by a non-participant is 403 not_member", %{
    carol: carol,
    conversation: conversation
  } do
    body =
      build_conn()
      |> authenticate(carol.token)
      |> get("/api/v1/conversations/#{conversation.id}/moments")
      |> json_response(403)

    assert body == %{"error" => %{"code" => "not_member"}}
  end

  test "POST /api/v1/conversations/:id/moments/promote promotes the caller's own message", %{
    alice: alice,
    conversation: conversation
  } do
    {:ok, message} =
      Chat.send_message(alice, conversation.id, %{
        clientOpId: Ecto.UUID.generate(),
        kind: :text,
        payload: %{"v" => 1, "text" => "promote me"}
      })

    body =
      build_conn()
      |> authenticate(alice.token)
      |> post("/api/v1/conversations/#{conversation.id}/moments/promote", %{
        "messageId" => message.id,
        "kind" => "text",
        "payload" => %{"v" => 1, "text" => "promoted"}
      })
      |> json_response(201)

    assert body["moment"]["sourceMessageId"] == message.id
  end

  test "promoting someone else's message is 403 forbidden", %{
    alice: alice,
    bob: bob,
    conversation: conversation
  } do
    {:ok, message} =
      Chat.send_message(alice, conversation.id, %{
        clientOpId: Ecto.UUID.generate(),
        kind: :text,
        payload: %{"v" => 1, "text" => "alice's"}
      })

    body =
      build_conn()
      |> authenticate(bob.token)
      |> post("/api/v1/conversations/#{conversation.id}/moments/promote", %{
        "messageId" => message.id,
        "kind" => "text",
        "payload" => %{"v" => 1}
      })
      |> json_response(403)

    assert body == %{"error" => %{"code" => "forbidden"}}
  end

  test "DELETE /api/v1/moments/:id deletes the author's moment", %{
    alice: alice,
    conversation: conversation
  } do
    {:ok, moment} =
      Moments.create(alice, conversation.id, %{kind: :text, payload: %{"v" => 1, "text" => "m"}})

    body =
      build_conn()
      |> authenticate(alice.token)
      |> delete("/api/v1/moments/#{moment.id}")
      |> json_response(200)

    assert body == %{}

    assert {:ok, %{moments: []}} = Moments.list(alice, conversation.id, %{})
  end

  test "DELETING someone else's moment is 403 forbidden", %{
    alice: alice,
    bob: bob,
    conversation: conversation
  } do
    {:ok, moment} =
      Moments.create(alice, conversation.id, %{kind: :text, payload: %{"v" => 1, "text" => "m"}})

    body =
      build_conn()
      |> authenticate(bob.token)
      |> delete("/api/v1/moments/#{moment.id}")
      |> json_response(403)

    assert body == %{"error" => %{"code" => "forbidden"}}
  end

  test "every moment route behind Auth answers 401 unauthorized without a token" do
    for {method, path, params} <- [
          {:post, "/api/v1/conversations/#{Ecto.UUID.generate()}/moments", %{"kind" => "text"}},
          {:get, "/api/v1/conversations/#{Ecto.UUID.generate()}/moments", nil},
          {:post, "/api/v1/conversations/#{Ecto.UUID.generate()}/moments/promote",
           %{"messageId" => Ecto.UUID.generate()}},
          {:delete, "/api/v1/moments/#{Ecto.UUID.generate()}", nil}
        ] do
      conn = Phoenix.ConnTest.dispatch(build_conn(), AwsemChatWeb.Endpoint, method, path, params)
      assert json_response(conn, 401) == %{"error" => %{"code" => "unauthorized"}}
    end
  end

  # A circle moment at the audience boundary: the HTTP surface must refuse a
  # late joiner exactly as the context does.
  test "a late joiner cannot list a prejoin moment over HTTP", %{alice: alice, bob: bob} do
    {:ok, circle} = Circles.create(alice, %{name: "Squad"})

    {:ok, moment} =
      Moments.create(alice, circle.id, %{kind: :text, payload: %{"v" => 1, "text" => "pre"}})

    {:ok, _} = Circles.invite(alice, circle.id, [bob.id])
    invitation = fetch_invitation(circle.id, bob.id)
    {:ok, _} = Circles.respond(bob, invitation.id, :accept)

    body =
      build_conn()
      |> authenticate(bob.token)
      |> get("/api/v1/conversations/#{circle.id}/moments")
      |> json_response(200)

    refute Enum.any?(body["moments"], &(&1["id"] == moment.id))
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
