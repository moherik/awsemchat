defmodule AwsemChatWeb.SharedMediaControllerTest do
  use AwsemChatWeb.ConnCase, async: true

  alias AwsemChat.Accounts
  alias AwsemChat.Chat
  alias AwsemChat.Media
  alias AwsemChat.Social

  @png <<0x89, "PNG\r\n", 0x1A, "\n">>

  setup do
    isolate_media_storage(limit: 10 * 1024 * 1024)

    alice = create_user("+15550007001")
    bob = create_user("+15550007002")
    carol = create_user("+15550007003")

    {:ok, request} = Social.request_by_pin(alice, bob.pin)
    {:ok, _} = Social.respond(bob, request.id, :accept)
    {:ok, conversation} = Social.private_conversation(alice, bob)

    %{alice: alice, bob: bob, carol: carol, conversation: conversation}
  end

  test "GET /api/v1/conversations/:id/media returns camelCase items newest first", %{
    alice: alice,
    conversation: conversation
  } do
    photo = send_media(alice, conversation.id, :media)
    _sticker = send_media(alice, conversation.id, :sticker)

    body =
      build_conn()
      |> authenticate(alice.token)
      |> get("/api/v1/conversations/#{conversation.id}/media")
      |> json_response(200)

    assert [item] = body["items"]
    assert item["mediaId"] == photo.media_id
    assert item["messageId"] == photo.message_id
    assert item["mime"] == "image/png"
    # Dimensions are reported as stored; the media row never fills them, so the
    # grid gets null rather than an invented size.
    assert item["width"] == nil
    assert item["height"] == nil
    assert is_binary(item["createdAt"])
    assert body["nextCursor"] == nil
    refute inspect(body) =~ "storage_path"
  end

  test "GET /api/v1/conversations/:id/media is 403 for a non-member", %{
    carol: carol,
    conversation: conversation
  } do
    body =
      build_conn()
      |> authenticate(carol.token)
      |> get("/api/v1/conversations/#{conversation.id}/media")
      |> json_response(403)

    assert body == %{"error" => %{"code" => "not_member"}}
  end

  test "GET /api/v1/conversations/:id/media is 404 for an unknown conversation", %{
    alice: alice
  } do
    body =
      build_conn()
      |> authenticate(alice.token)
      |> get("/api/v1/conversations/#{Ecto.UUID.generate()}/media")
      |> json_response(404)

    assert body == %{"error" => %{"code" => "not_found"}}
  end

  test "GET /api/v1/conversations/:id/media without a token is 401", %{
    conversation: conversation
  } do
    body =
      build_conn()
      |> get("/api/v1/conversations/#{conversation.id}/media")
      |> json_response(401)

    assert body == %{"error" => %{"code" => "unauthorized"}}
  end

  test "GET /api/v1/conversations/:id/media rejects a bad cursor with 400", %{
    alice: alice,
    conversation: conversation
  } do
    body =
      build_conn()
      |> authenticate(alice.token)
      |> get("/api/v1/conversations/#{conversation.id}/media?cursor=not-a-cursor")
      |> json_response(400)

    assert body == %{"error" => %{"code" => "invalid_cursor"}}
  end

  defp send_media(user, conversation_id, kind) do
    {:ok, media} = Media.upload(user, upload_fixture())

    {:ok, message} =
      Chat.send_message(user, conversation_id, %{
        clientOpId: Ecto.UUID.generate(),
        kind: kind,
        payload: %{"v" => 1},
        mediaIds: [media.id]
      })

    %{media_id: media.id, message_id: message.id}
  end

  defp create_user(phone) do
    {:ok, _} = Accounts.request_code(phone)
    {:ok, %{user: user, token: token}} = Accounts.verify_code(phone, "123456")
    Map.put(user, :token, token)
  end

  defp authenticate(conn, token), do: put_req_header(conn, "authorization", "Bearer #{token}")

  defp upload_fixture do
    dir = Path.join(System.tmp_dir!(), "awsemchat-smc-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    path = Path.join(dir, "upload.png")
    File.write!(path, @png)
    on_exit(fn -> File.rm_rf(dir) end)

    %Plug.Upload{path: path, filename: "photo.png", content_type: "image/png"}
  end
end
