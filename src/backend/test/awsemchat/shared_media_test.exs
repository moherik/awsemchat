defmodule AwsemChat.SharedMediaTest do
  use AwsemChat.DataCase, async: true

  alias AwsemChat.Accounts
  alias AwsemChat.Chat
  alias AwsemChat.Chat.{CircleInvitation, Conversation}
  alias AwsemChat.Circles
  alias AwsemChat.Media
  alias AwsemChat.Social

  setup do
    isolate_media_storage(limit: 10 * 1024 * 1024)

    alice = create_user("+15550006001")
    bob = create_user("+15550006002")
    carol = create_user("+15550006003")
    conversation = friends_with(alice, bob)

    %{alice: alice, bob: bob, carol: carol, conversation: conversation}
  end

  test "test_shared_media_excludes_stickers", %{
    alice: alice,
    conversation: conv
  } do
    photo = send_media(alice, conv.id, kind: :media)
    sticker = send_media(alice, conv.id, kind: :sticker)

    assert {:ok, %{items: items}} = Chat.list_shared_media(alice, conv.id, %{})

    media_ids = Enum.map(items, & &1.media_id)
    assert photo.media_id in media_ids
    refute sticker.media_id in media_ids
  end

  test "test_shared_media_requires_membership", %{
    alice: alice,
    carol: carol,
    conversation: conv
  } do
    _photo = send_media(alice, conv.id, kind: :media)

    assert {:error, :not_member} = Chat.list_shared_media(carol, conv.id, %{})

    assert {:error, :not_found} =
             Chat.list_shared_media(alice, Ecto.UUID.generate(), %{})
  end

  test "test_shared_media_respects_circle_join_boundary" do
    owner = create_user("+15550006011")
    joiner = create_user("+15550006012")

    assert {:ok, request} = Social.request_by_pin(owner, joiner.pin)
    assert {:ok, _} = Social.respond(joiner, request.id, :accept)

    assert {:ok, circle} = Circles.create(owner, %{name: "Squad"})
    _ = Repo.get_by!(Conversation, id: circle.id)

    # The owner shares a photo before the joiner joins the circle.
    before = send_media(owner, circle.id, kind: :media)

    assert {:ok, _results} = Circles.invite(owner, circle.id, [joiner.id])
    inv = Repo.get_by!(CircleInvitation, circle_id: circle.id, invitee_id: joiner.id)
    assert {:ok, _membership} = Circles.respond(joiner, inv.id, :accept)

    # The joiner is a member now but must not see media sent before they joined.
    assert {:ok, %{items: items}} = Chat.list_shared_media(joiner, circle.id, %{})
    refute Enum.any?(items, &(&1.media_id == before.media_id))

    # The owner still sees it, and a photo shared after the join is visible to both.
    assert {:ok, %{items: owner_items}} = Chat.list_shared_media(owner, circle.id, %{})
    assert Enum.any?(owner_items, &(&1.media_id == before.media_id))

    after_join = send_media(owner, circle.id, kind: :media)
    assert {:ok, %{items: joiner_after}} = Chat.list_shared_media(joiner, circle.id, %{})
    assert Enum.any?(joiner_after, &(&1.media_id == after_join.media_id))
  end

  test "test_shared_media_newest_first_with_cursor_pagination", %{
    alice: alice,
    conversation: conv
  } do
    shared = Enum.map(1..5, fn _ -> send_media(alice, conv.id, kind: :media) end)
    newest_first = Enum.reverse(shared)

    assert {:ok, %{items: page1, nextCursor: cursor}} =
             Chat.list_shared_media(alice, conv.id, %{limit: 2})

    assert Enum.map(page1, & &1.media_id) == Enum.map(Enum.take(newest_first, 2), & &1.media_id)
    assert cursor

    assert {:ok, %{items: page2, nextCursor: cursor2}} =
             Chat.list_shared_media(alice, conv.id, %{limit: 2, cursor: cursor})

    assert Enum.map(page2, & &1.media_id) ==
             Enum.map(Enum.slice(newest_first, 2, 2), & &1.media_id)

    assert cursor2

    assert {:ok, %{items: page3, nextCursor: nil}} =
             Chat.list_shared_media(alice, conv.id, %{limit: 2, cursor: cursor2})

    assert Enum.map(page3, & &1.media_id) == [List.last(newest_first).media_id]

    assert {:error, :invalid_cursor} =
             Chat.list_shared_media(alice, conv.id, %{cursor: "not-a-cursor"})
  end

  test "test_shared_media_item_shape", %{alice: alice, conversation: conv} do
    sent = send_media(alice, conv.id, kind: :media)

    assert {:ok, %{items: [item]}} = Chat.list_shared_media(alice, conv.id, %{})
    assert item.media_id == sent.media_id
    assert item.message_id == sent.message_id
    assert item.mime == "image/png"
    # `media.width`/`media.height` are never populated (Task 3 reserved them), so
    # the row reports them as null rather than inventing a size.
    assert Map.has_key?(item, :width)
    assert Map.has_key?(item, :height)
    assert item.created_at
  end

  defp send_media(user, conversation_id, opts) do
    {:ok, media} = Media.upload(user, upload_fixture())

    {:ok, message} =
      Chat.send_message(user, conversation_id, %{
        clientOpId: Ecto.UUID.generate(),
        kind: Keyword.fetch!(opts, :kind),
        payload: %{"v" => 1},
        mediaIds: [media.id]
      })

    %{media_id: media.id, message_id: message.id}
  end

  defp friends_with(alice, bob) do
    {:ok, request} = Social.request_by_pin(alice, bob.pin)
    {:ok, _} = Social.respond(bob, request.id, :accept)
    {:ok, conversation} = Social.private_conversation(alice, bob)
    conversation
  end

  defp create_user(phone) do
    {:ok, _} = Accounts.request_code(phone)
    {:ok, %{user: user}} = Accounts.verify_code(phone, "123456")
    user
  end

  defp upload_fixture do
    dir = Path.join(System.tmp_dir!(), "awsemchat-shared-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    path = Path.join(dir, "upload.png")
    File.write!(path, <<0x89, "PNG\r\n", 0x1A, "\n">>)
    on_exit(fn -> File.rm_rf(dir) end)

    %Plug.Upload{path: path, filename: "photo.png", content_type: "image/png"}
  end
end
