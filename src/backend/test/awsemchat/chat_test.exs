defmodule AwsemChat.ChatTest do
  use AwsemChat.DataCase, async: true

  alias AwsemChat.Accounts
  alias AwsemChat.Chat
  alias AwsemChat.Chat.{Delivery, Envelope, Message}
  alias AwsemChat.Media
  alias AwsemChat.Social

  @payload_cap 256 * 1024

  setup do
    isolate_media_storage(limit: 10 * 1024 * 1024)

    alice = create_user("+15550004001")
    bob = create_user("+15550004002")
    carol = create_user("+15550004003")
    conversation = friends_with(alice, bob)

    %{alice: alice, bob: bob, carol: carol, conversation: conversation}
  end

  test "test_idempotent_send_returns_original", %{alice: alice, bob: bob, conversation: conv} do
    attrs = message_attrs()

    assert {:ok, first} = Chat.send_message(alice, conv.id, attrs)
    refute Enum.empty?(Chat.list_deliveries(first))

    assert {:ok, second} = Chat.send_message(alice, conv.id, attrs)

    assert second.id == first.id
    assert Repo.aggregate(Message, :count) == 1
    # No second set of deliveries either — the retry is invisible to recipients.
    assert length(Chat.list_deliveries(first)) == 2
    assert Repo.aggregate(Delivery, :count) == 2

    assert Enum.map(Chat.list_deliveries(first), & &1.user_id) |> Enum.sort() ==
             Enum.sort([alice.id, bob.id])
  end

  test "test_send_refused_after_unfriend_still_reads_history", %{
    alice: alice,
    bob: bob,
    conversation: conv
  } do
    assert {:ok, message} = Chat.send_message(alice, conv.id, message_attrs())

    assert :ok = Social.unfriend(alice, bob)

    assert {:error, :conversation_read_only} =
             Chat.send_message(alice, conv.id, message_attrs())

    assert {:error, :conversation_read_only} =
             Chat.send_message(bob, conv.id, message_attrs())

    # History is intact and readable by both sides.
    assert {:ok, %{messages: [listed]}} = Chat.list_messages(alice, conv.id, %{})
    assert listed.id == message.id
    assert {:ok, %{messages: [_]}} = Chat.list_messages(bob, conv.id, %{})
  end

  test "test_send_refused_when_blocked", %{alice: alice, bob: bob, conversation: conv} do
    assert :ok = Social.block(alice, bob)

    assert {:error, :blocked} = Chat.send_message(bob, conv.id, message_attrs())
    assert {:error, :blocked} = Chat.send_message(alice, conv.id, message_attrs())
  end

  test "test_payload_over_256kb_rejected", %{alice: alice, conversation: conv} do
    oversize = %{"v" => 1, "text" => String.duplicate("a", @payload_cap)}

    assert {:error, :payload_too_large} =
             Chat.send_message(alice, conv.id, message_attrs(%{payload: oversize}))

    assert Repo.aggregate(Message, :count) == 0
  end

  test "test_payload_just_under_cap_accepted", %{alice: alice, conversation: conv} do
    # The cap applies to the encoded size; leave room for the JSON envelope.
    payload = %{"v" => 1, "text" => String.duplicate("a", @payload_cap - 100)}

    assert {:ok, %Message{}} =
             Chat.send_message(alice, conv.id, message_attrs(%{payload: payload}))
  end

  test "test_message_pagination_cursor_stable", %{alice: alice, conversation: conv} do
    sent = Enum.map(1..12, fn i -> send_text(alice, conv.id, "message #{i}") end)

    # Newest first: the last five sent, reversed.
    newest = sent |> Enum.reverse() |> Enum.take(5)

    assert {:ok, %{messages: page1, nextCursor: cursor}} =
             Chat.list_messages(alice, conv.id, %{limit: 5})

    assert Enum.map(page1, & &1.id) == Enum.map(newest, & &1.id)
    assert cursor

    assert {:ok, %{messages: page2, nextCursor: cursor2}} =
             Chat.list_messages(alice, conv.id, %{limit: 5, cursor: cursor})

    # Newest-first, no overlap, no gap.
    ids = Enum.map(page1, & &1.id) ++ Enum.map(page2, & &1.id)
    assert length(Enum.uniq(ids)) == 10

    # A message arriving between page fetches does not shift the cursor window.
    send_text(alice, conv.id, "late arrival")

    assert {:ok, %{messages: page2_again}} =
             Chat.list_messages(alice, conv.id, %{limit: 5, cursor: cursor})

    assert Enum.map(page2_again, & &1.id) == Enum.map(page2, & &1.id)

    assert {:ok, %{messages: page3, nextCursor: nil}} =
             Chat.list_messages(alice, conv.id, %{limit: 5, cursor: cursor2})

    assert Enum.map(page3, & &1.id) == Enum.map(Enum.take(sent, 2) |> Enum.reverse(), & &1.id)
  end

  test "test_list_messages_defaults_to_fifty_newest_first", %{alice: alice, conversation: conv} do
    Enum.each(1..60, fn i -> send_text(alice, conv.id, "message #{i}") end)

    assert {:ok, %{messages: messages, nextCursor: cursor}} =
             Chat.list_messages(alice, conv.id, %{})

    assert length(messages) == 50

    timestamps = Enum.map(messages, & &1.created_at)
    assert timestamps == Enum.sort(timestamps, {:desc, DateTime})

    assert cursor
    # The page holds the newest 50 of 60, so the oldest 10 are behind the cursor.
    assert {:ok, %{messages: older}} =
             Chat.list_messages(alice, conv.id, %{limit: 50, cursor: cursor})

    assert length(older) == 10
  end

  test "test_reply_to_message_in_same_conversation_renders_in_envelope", %{
    alice: alice,
    conversation: conv
  } do
    original = send_text(alice, conv.id, "question?")

    assert {:ok, reply} =
             Chat.send_message(
               alice,
               conv.id,
               message_attrs(%{replyTo: %{kind: "message", id: original.id}})
             )

    assert reply.reply_to_message_id == original.id

    rendered = Envelope.render(reply)
    assert rendered.replyTo == %{kind: "message", id: original.id}
  end

  test "test_reply_to_message_in_other_conversation_rejected", %{alice: alice, conversation: conv} do
    other = friends_with(alice, create_user("+15550004009"))
    foreign = send_text(alice, other.id, "elsewhere")

    assert {:error, :not_found} =
             Chat.send_message(
               alice,
               conv.id,
               message_attrs(%{replyTo: %{kind: "message", id: foreign.id}})
             )

    assert {:error, :not_found} =
             Chat.send_message(
               alice,
               conv.id,
               message_attrs(%{replyTo: %{kind: "message", id: Ecto.UUID.generate()}})
             )
  end

  test "test_malformed_reply_reference_rejected", %{alice: alice, conversation: conv} do
    # A moment reply, a nonsense kind, and a non-map all refuse the send rather
    # than raising.
    for reply_to <- [
          %{kind: "moment", id: Ecto.UUID.generate()},
          %{kind: "banana", id: Ecto.UUID.generate()},
          "not-a-map"
        ] do
      assert {:error, :not_found} =
               Chat.send_message(alice, conv.id, message_attrs(%{replyTo: reply_to}))
    end

    assert Repo.aggregate(Message, :count) == 0
  end

  test "test_send_by_non_member_is_not_member", %{
    carol: carol,
    conversation: conv
  } do
    assert {:error, :not_member} = Chat.send_message(carol, conv.id, message_attrs())

    assert {:error, :not_member} = Chat.list_messages(carol, conv.id, %{})
  end

  test "test_send_to_unknown_conversation_is_not_found", %{alice: alice} do
    assert {:error, :not_found} =
             Chat.send_message(alice, Ecto.UUID.generate(), message_attrs())

    assert {:error, :not_found} = Chat.list_messages(alice, Ecto.UUID.generate(), %{})
  end

  test "test_unknown_kind_rejected", %{alice: alice, conversation: conv} do
    assert {:error, :invalid_kind} =
             Chat.send_message(alice, conv.id, message_attrs(%{kind: :nonsense}))
  end

  test "test_media_message_records_reference_with_send_time_audience", %{
    alice: alice,
    bob: bob,
    conversation: conv
  } do
    {:ok, media} = Media.upload(alice, upload_fixture())

    assert {:ok, message} =
             Chat.send_message(
               alice,
               conv.id,
               message_attrs(%{kind: :media, mediaIds: [media.id]})
             )

    # Both participants may read; a stranger may not.
    assert Media.authorized?(bob, media)
    assert Media.authorized?(alice, media)

    stranger = create_user("+15550004008")
    refute Media.authorized?(stranger, media)

    assert Chat.media_ids(message) == [media.id]
  end

  test "test_media_reference_ignores_client_supplied_extra_audience", %{
    alice: alice,
    conversation: conv
  } do
    {:ok, media} = Media.upload(alice, upload_fixture())
    stranger = create_user("+15550004007")

    # A hostile client cannot widen read access by naming users in the request.
    assert {:ok, message} =
             Chat.send_message(
               alice,
               conv.id,
               message_attrs(%{
                 kind: :media,
                 mediaIds: [media.id],
                 userIds: [stranger.id]
               })
             )

    refute Media.authorized?(stranger, media)
    assert Chat.media_ids(message) == [media.id]
  end

  test "test_cannot_attach_media_owned_by_someone_else", %{
    alice: alice,
    bob: bob,
    conversation: conv
  } do
    # Bob uploads a photo; Alice must not be able to pull it into her message,
    # which would add her and the audience to its read list.
    {:ok, bobs_media} = Media.upload(bob, upload_fixture())

    assert {:error, :not_found} =
             Chat.send_message(
               alice,
               conv.id,
               message_attrs(%{kind: :media, mediaIds: [bobs_media.id]})
             )

    assert Repo.aggregate(Message, :count) == 0
    refute Media.authorized?(alice, bobs_media)
    assert Media.authorized?(bob, bobs_media)
  end

  test "test_unknown_media_id_rejected", %{alice: alice, conversation: conv} do
    assert {:error, :not_found} =
             Chat.send_message(
               alice,
               conv.id,
               message_attrs(%{kind: :media, mediaIds: [Ecto.UUID.generate()]})
             )

    assert Repo.aggregate(Message, :count) == 0
  end

  test "test_envelope_shape_matches_contract", %{alice: alice, bob: bob, conversation: conv} do
    {:ok, media} = Media.upload(alice, upload_fixture())

    assert {:ok, message} =
             Chat.send_message(
               alice,
               conv.id,
               message_attrs(%{kind: :media, mediaIds: [media.id]})
             )

    rendered = Envelope.render(message)

    assert %{
             id: id,
             conversationId: conversation_id,
             senderId: sender_id,
             clientOpId: client_op_id,
             kind: "media",
             payload: %{"v" => 1},
             replyTo: nil,
             mediaIds: [media_id],
             createdAt: created_at
           } = rendered

    assert id == message.id
    assert conversation_id == conv.id
    assert sender_id == alice.id
    assert client_op_id == message.client_op_id
    assert media_id == media.id
    assert is_binary(created_at)
    assert {:ok, _, _} = DateTime.from_iso8601(created_at)
    refute Map.has_key?(rendered, :sender)
    # Bob never appears in Alice's envelope; no cross-user read state.
    refute inspect(rendered) =~ bob.id
  end

  test "test_sticker_kind_carries_media_id_in_payload", %{alice: alice, conversation: conv} do
    {:ok, media} = Media.upload(alice, upload_fixture())

    payload = %{"v" => 1, "sticker" => %{"pack" => "cats", "mediaId" => media.id}}

    assert {:ok, message} =
             Chat.send_message(
               alice,
               conv.id,
               message_attrs(%{kind: :sticker, mediaIds: [media.id], payload: payload})
             )

    assert Envelope.render(message).kind == "sticker"
    assert Envelope.render(message).payload["sticker"]["mediaId"] == media.id
  end

  test "test_moment_ref_kind_reserved", %{alice: alice, conversation: conv} do
    payload = %{"v" => 1, "momentId" => Ecto.UUID.generate()}

    assert {:ok, message} =
             Chat.send_message(
               alice,
               conv.id,
               message_attrs(%{kind: :"moment-ref", payload: payload})
             )

    assert Envelope.render(message).kind == "moment-ref"
  end

  test "test_deliveries_capture_intended_recipients_at_send_time", %{
    alice: alice,
    bob: bob,
    conversation: conv
  } do
    {:ok, message} = Chat.send_message(alice, conv.id, message_attrs())

    assert Enum.map(Chat.list_deliveries(message), & &1.user_id) |> Enum.sort() ==
             Enum.sort([alice.id, bob.id])

    assert Enum.all?(Chat.list_deliveries(message), &is_nil(&1.delivered_at))
  end

  test "test_no_leftover_state_between_sends", %{alice: alice, conversation: conv} do
    assert {:ok, _} = Chat.send_message(alice, conv.id, message_attrs())
    assert Repo.aggregate(Message, :count) == 1
  end

  test "test_get_conversation_returns_nil_for_non_participant", %{
    alice: alice,
    carol: carol,
    conversation: conv
  } do
    assert %{id: _} = Chat.get_conversation(alice, conv.id)
    assert Chat.get_conversation(carol, conv.id) == nil
  end

  defp send_text(user, conversation_id, text) do
    {:ok, message} =
      Chat.send_message(
        user,
        conversation_id,
        message_attrs(%{payload: %{"v" => 1, "text" => text}})
      )

    message
  end

  defp friends_with(alice, bob) do
    {:ok, request} = Social.request_by_pin(alice, bob.pin)
    {:ok, _} = Social.respond(bob, request.id, :accept)
    {:ok, conversation} = Social.private_conversation(alice, bob)
    conversation
  end

  defp message_attrs(attrs \\ %{}) do
    Map.merge(
      %{
        clientOpId: Ecto.UUID.generate(),
        kind: :text,
        payload: %{"v" => 1, "text" => "hello"}
      },
      attrs
    )
  end

  defp create_user(phone) do
    {:ok, _} = Accounts.request_code(phone)
    {:ok, %{user: user}} = Accounts.verify_code(phone, "123456")
    user
  end

  defp upload_fixture do
    dir = Path.join(System.tmp_dir!(), "awsemchat-chat-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    path = Path.join(dir, "upload.bin")
    File.write!(path, <<0x89, "PNG\r\n", 0x1A, "\n">>)
    on_exit(fn -> File.rm_rf(dir) end)

    %Plug.Upload{path: path, filename: "photo.png", content_type: "image/png"}
  end
end
