defmodule AwsemChatWeb.ConversationsControllerTest do
  use AwsemChatWeb.ConnCase, async: true

  alias AwsemChat.Accounts
  alias AwsemChat.Chat
  alias AwsemChat.Social

  setup do
    alice = create_user("+15550005001")
    bob = create_user("+15550005002")

    {:ok, request} = Social.request_by_pin(alice, bob.pin)
    {:ok, _} = Social.respond(bob, request.id, :accept)
    {:ok, conversation} = Social.private_conversation(alice, bob)

    %{alice: alice, bob: bob, conversation: conversation}
  end

  test "POST /api/v1/conversations returns the private conversation with the peer", %{
    alice: alice,
    bob: bob
  } do
    body =
      build_conn()
      |> authenticate(alice.token)
      |> post("/api/v1/conversations", %{"peerUserId" => bob.id})
      |> json_response(200)

    assert body["type"] == "private"
    assert body["peer"]["id"] == bob.id
    refute inspect(body) =~ "privateKey"
  end

  test "POST /api/v1/conversations without a friendship is 403", %{bob: bob} do
    carol = create_user("+15550005003")

    body =
      build_conn()
      |> authenticate(carol.token)
      |> post("/api/v1/conversations", %{"peerUserId" => bob.id})
      |> json_response(403)

    assert body == %{"error" => %{"code" => "not_friends"}}
  end

  test "POST /api/v1/conversations with an unknown peer is 404", %{alice: alice} do
    body =
      build_conn()
      |> authenticate(alice.token)
      |> post("/api/v1/conversations", %{"peerUserId" => Ecto.UUID.generate()})
      |> json_response(404)

    assert body == %{"error" => %{"code" => "user_not_found"}}
  end

  test "POST then GET /api/v1/conversations/:id/messages round-trips an envelope", %{
    alice: alice,
    conversation: conversation
  } do
    client_op_id = Ecto.UUID.generate()

    sent =
      build_conn()
      |> authenticate(alice.token)
      |> post("/api/v1/conversations/#{conversation.id}/messages", %{
        "clientOpId" => client_op_id,
        "kind" => "text",
        "payload" => %{"v" => 1, "text" => "hello"}
      })
      |> json_response(201)

    assert sent["conversationId"] == conversation.id
    assert sent["senderId"] == alice.id
    assert sent["clientOpId"] == client_op_id
    assert sent["kind"] == "text"
    assert sent["payload"] == %{"v" => 1, "text" => "hello"}

    listed =
      build_conn()
      |> authenticate(alice.token)
      |> get("/api/v1/conversations/#{conversation.id}/messages")
      |> json_response(200)

    assert [message] = listed["messages"]
    assert message["id"] == sent["id"]
    assert listed["nextCursor"] == nil
  end

  test "POST /api/v1/conversations/:id/messages retries idempotently", %{
    alice: alice,
    conversation: conversation
  } do
    params = %{"clientOpId" => Ecto.UUID.generate(), "kind" => "text", "payload" => %{"v" => 1}}
    path = "/api/v1/conversations/#{conversation.id}/messages"

    first = build_conn() |> authenticate(alice.token) |> post(path, params) |> json_response(201)
    second = build_conn() |> authenticate(alice.token) |> post(path, params) |> json_response(201)

    assert first["id"] == second["id"]
    assert AwsemChat.Repo.aggregate(AwsemChat.Chat.Message, :count) == 1
  end

  test "POST /api/v1/conversations/:id/messages over the cap is 413", %{
    alice: alice,
    conversation: conversation
  } do
    body =
      build_conn()
      |> authenticate(alice.token)
      |> post("/api/v1/conversations/#{conversation.id}/messages", %{
        "clientOpId" => Ecto.UUID.generate(),
        "kind" => "text",
        "payload" => %{"v" => 1, "text" => String.duplicate("a", 256 * 1024)}
      })
      |> json_response(413)

    assert body == %{"error" => %{"code" => "payload_too_large"}}
  end

  test "POST /api/v1/conversations/:id/messages after unfriend is 409 read-only", %{
    alice: alice,
    bob: bob,
    conversation: conversation
  } do
    assert :ok = Social.unfriend(alice, bob)

    body =
      build_conn()
      |> authenticate(alice.token)
      |> post("/api/v1/conversations/#{conversation.id}/messages", %{
        "clientOpId" => Ecto.UUID.generate(),
        "kind" => "text",
        "payload" => %{"v" => 1}
      })
      |> json_response(409)

    assert body == %{"error" => %{"code" => "conversation_read_only"}}

    # History still lists.
    listed =
      build_conn()
      |> authenticate(alice.token)
      |> get("/api/v1/conversations/#{conversation.id}/messages")
      |> json_response(200)

    assert listed["messages"] == []
  end

  test "POST /api/v1/conversations/:id/messages after block is 403", %{
    alice: alice,
    bob: bob,
    conversation: conversation
  } do
    assert :ok = Social.block(alice, bob)

    body =
      build_conn()
      |> authenticate(bob.token)
      |> post("/api/v1/conversations/#{conversation.id}/messages", %{
        "clientOpId" => Ecto.UUID.generate(),
        "kind" => "text",
        "payload" => %{"v" => 1}
      })
      |> json_response(403)

    assert body == %{"error" => %{"code" => "blocked"}}
  end

  test "POST /api/v1/conversations/:id/messages as a non-member is 403", %{
    conversation: conversation
  } do
    carol = create_user("+15550005004")

    body =
      build_conn()
      |> authenticate(carol.token)
      |> post("/api/v1/conversations/#{conversation.id}/messages", %{
        "clientOpId" => Ecto.UUID.generate(),
        "kind" => "text",
        "payload" => %{"v" => 1}
      })
      |> json_response(403)

    assert body == %{"error" => %{"code" => "not_member"}}
  end

  test "POST /api/v1/conversations/:id/messages with a cross-conversation reply is 404", %{
    alice: alice,
    conversation: conversation
  } do
    other = other_conversation(alice)

    {:ok, foreign} =
      Chat.send_message(alice, other.id, %{
        clientOpId: Ecto.UUID.generate(),
        kind: :text,
        payload: %{"v" => 1}
      })

    body =
      build_conn()
      |> authenticate(alice.token)
      |> post("/api/v1/conversations/#{conversation.id}/messages", %{
        "clientOpId" => Ecto.UUID.generate(),
        "kind" => "text",
        "payload" => %{"v" => 1},
        "replyTo" => %{"kind" => "message", "id" => foreign.id}
      })
      |> json_response(404)

    assert body == %{"error" => %{"code" => "not_found"}}
  end

  test "GET /api/v1/conversations/:id/messages is 401 without a token", %{
    conversation: conversation
  } do
    body =
      build_conn()
      |> get("/api/v1/conversations/#{conversation.id}/messages")
      |> json_response(401)

    assert body == %{"error" => %{"code" => "unauthorized"}}
  end

  test "GET /api/v1/conversations/:id/messages is 404 for an unknown conversation", %{
    alice: alice
  } do
    body =
      build_conn()
      |> authenticate(alice.token)
      |> get("/api/v1/conversations/#{Ecto.UUID.generate()}/messages")
      |> json_response(404)

    assert body == %{"error" => %{"code" => "not_found"}}
  end

  test "GET /api/v1/conversations/:id/messages paginates with a cursor", %{
    alice: alice,
    conversation: conversation
  } do
    Enum.each(1..5, fn i ->
      {:ok, _} =
        Chat.send_message(alice, conversation.id, %{
          clientOpId: Ecto.UUID.generate(),
          kind: :text,
          payload: %{"v" => 1, "text" => Integer.to_string(i)}
        })
    end)

    first =
      build_conn()
      |> authenticate(alice.token)
      |> get("/api/v1/conversations/#{conversation.id}/messages?limit=2")
      |> json_response(200)

    assert length(first["messages"]) == 2
    assert is_binary(first["nextCursor"])

    second =
      build_conn()
      |> authenticate(alice.token)
      |> get(
        "/api/v1/conversations/#{conversation.id}/messages?limit=2&cursor=#{first["nextCursor"]}"
      )
      |> json_response(200)

    assert length(second["messages"]) == 2

    first_ids = Enum.map(first["messages"], & &1["id"])
    second_ids = Enum.map(second["messages"], & &1["id"])
    assert Enum.all?(second_ids, &(&1 not in first_ids))
  end

  test "POST /api/v1/conversations/:id/messages rejects media owned by someone else", %{
    alice: alice,
    bob: bob,
    conversation: conversation
  } do
    dir = Path.join(System.tmp_dir!(), "awsemchat-media-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    path = Path.join(dir, "photo.png")
    File.write!(path, <<0x89, "PNG\r\n", 0x1A, "\n">>)
    on_exit(fn -> File.rm_rf(dir) end)

    {:ok, bobs_media} =
      AwsemChat.Media.upload(bob, %Plug.Upload{
        path: path,
        filename: "photo.png",
        content_type: "image/png"
      })

    body =
      build_conn()
      |> authenticate(alice.token)
      |> post("/api/v1/conversations/#{conversation.id}/messages", %{
        "clientOpId" => Ecto.UUID.generate(),
        "kind" => "media",
        "payload" => %{"v" => 1},
        "mediaIds" => [bobs_media.id]
      })
      |> json_response(404)

    assert body == %{"error" => %{"code" => "not_found"}}
  end

  test "GET /api/v1/friends lists accepted friends with a profile", %{alice: alice, bob: bob} do
    body =
      build_conn()
      |> authenticate(alice.token)
      |> get("/api/v1/friends")
      |> json_response(200)

    assert [friend] = body["friends"]
    assert friend["id"] == bob.id
    refute inspect(friend) =~ "phone"
  end

  test "POST /api/v1/friends/requests plus accept creates the friendship", %{bob: bob} do
    carol = create_user("+15550005005")

    request =
      build_conn()
      |> authenticate(carol.token)
      |> post("/api/v1/friends/requests", %{"pin" => bob.pin})
      |> json_response(201)

    assert request["state"] == "pending"
    assert request["recipient"]["id"] == bob.id

    accepted =
      build_conn()
      |> authenticate(bob.token)
      |> post("/api/v1/friends/requests/#{request["id"]}/accept")
      |> json_response(200)

    assert accepted["state"] == "accepted"

    friends =
      build_conn() |> authenticate(carol.token) |> get("/api/v1/friends") |> json_response(200)

    assert [friend] = friends["friends"]
    assert friend["id"] == bob.id
  end

  test "POST /api/v1/friends/requests with an unknown pin is 404", %{alice: alice} do
    body =
      build_conn()
      |> authenticate(alice.token)
      |> post("/api/v1/friends/requests", %{"pin" => "ZZZZZZ"})
      |> json_response(404)

    assert body == %{"error" => %{"code" => "not_found"}}
  end

  test "POST /api/v1/friends/requests when blocked is 403", %{alice: alice, bob: bob} do
    assert :ok = Social.block(bob, alice)

    body =
      build_conn()
      |> authenticate(alice.token)
      |> post("/api/v1/friends/requests", %{"pin" => bob.pin})
      |> json_response(403)

    assert body == %{"error" => %{"code" => "blocked"}}
  end

  test "DELETE /api/v1/friends/:userId unfriends idempotently, 404 for unknown user", %{
    alice: alice,
    bob: bob
  } do
    assert %{} =
             build_conn()
             |> authenticate(alice.token)
             |> delete("/api/v1/friends/#{bob.id}")
             |> json_response(200)

    refute Social.are_friends?(alice, bob)

    # Idempotent: unfriending a non-friend is not an error.
    assert %{} =
             build_conn()
             |> authenticate(alice.token)
             |> delete("/api/v1/friends/#{bob.id}")
             |> json_response(200)

    body =
      build_conn()
      |> authenticate(alice.token)
      |> delete("/api/v1/friends/#{Ecto.UUID.generate()}")
      |> json_response(404)

    assert body == %{"error" => %{"code" => "not_found"}}
  end

  test "POST and DELETE /api/v1/blocks round-trips", %{alice: alice, bob: bob} do
    assert %{} =
             build_conn()
             |> authenticate(alice.token)
             |> post("/api/v1/blocks", %{"userId" => bob.id})
             |> json_response(200)

    assert Social.blocked_either?(alice, bob)

    listed =
      build_conn() |> authenticate(alice.token) |> get("/api/v1/blocks") |> json_response(200)

    assert [blocked] = listed["blocks"]
    assert blocked["id"] == bob.id

    assert %{} =
             build_conn()
             |> authenticate(alice.token)
             |> delete("/api/v1/blocks/#{bob.id}")
             |> json_response(200)

    refute Social.blocked_either?(alice, bob)
  end

  test "unauthenticated access to friends and blocks is 401" do
    assert %{"error" => %{"code" => "unauthorized"}} =
             build_conn() |> get("/api/v1/friends") |> json_response(401)

    assert %{"error" => %{"code" => "unauthorized"}} =
             build_conn() |> get("/api/v1/blocks") |> json_response(401)
  end

  defp other_conversation(alice) do
    dave = create_user("+15550005006")
    {:ok, request} = Social.request_by_pin(alice, dave.pin)
    {:ok, _} = Social.respond(dave, request.id, :accept)
    {:ok, conversation} = Social.private_conversation(alice, dave)
    conversation
  end

  defp create_user(phone) do
    {:ok, _} = Accounts.request_code(phone)
    {:ok, %{user: user, token: token}} = Accounts.verify_code(phone, "123456")
    Map.put(user, :token, token)
  end

  defp authenticate(conn, token), do: put_req_header(conn, "authorization", "Bearer #{token}")
end
