defmodule AwsemChat.MediaTest do
  use AwsemChat.DataCase, async: true

  alias AwsemChat.Accounts
  alias AwsemChat.Media
  alias AwsemChat.Media.LocalStore

  # The real cap is 10 MB; tests inject a small one so the same code path runs
  # without writing ten megabytes to disk.
  @test_limit 64

  setup do
    isolate_media_storage(limit: @test_limit, allowed_mime: ["image/png"], store: LocalStore)

    owners = %{owner: create_user("+15550001001"), stranger: create_user("+15550001002")}

    {:ok, owners}
  end

  test "upload stores a media row and the bytes on disk", %{owner: owner} do
    upload = upload_fixture(png(), content_type: "image/png", filename: "photo.png")

    assert {:ok, media} = Media.upload(owner, upload)

    assert media.owner_id == owner.id
    assert media.mime == "image/png"
    assert media.byte_size == byte_size(png())
    assert media.storage_path =~ "media/"
    assert %DateTime{} = media.inserted_at

    assert read_stored(media) == png()
    refute media.storage_path == upload.path
  end

  test "upload never derives the storage path from the client filename", %{owner: owner} do
    upload = upload_fixture(png(), content_type: "image/png", filename: "../../../etc/passwd")

    assert {:ok, media} = Media.upload(owner, upload)

    refute media.storage_path =~ "etc"
    refute media.storage_path =~ "passwd"
    assert media.storage_path =~ ~r|\Amedia/[0-9a-f-]{36}\z|
  end

  test "upload rejects a payload over the limit without writing it", %{owner: owner} do
    oversize = :binary.copy("a", @test_limit + 1)
    upload = upload_fixture(oversize, content_type: "image/png", filename: "big.png")

    assert {:error, :too_large} = Media.upload(owner, upload)
    assert Repo.aggregate(Media.Media, :count) == 0
    assert {:ok, []} = LocalStore.list()
  end

  test "upload rejects an unsupported content type without writing it", %{owner: owner} do
    upload = upload_fixture(<<"%PDF-1.4">>, content_type: "application/pdf", filename: "doc.pdf")

    assert {:error, :unsupported} = Media.upload(owner, upload)
    assert Repo.aggregate(Media.Media, :count) == 0
    assert {:ok, []} = LocalStore.list()
  end

  test "fetch! returns the row and raises on an unknown id" do
    assert_raise Ecto.NoResultsError, fn -> Media.fetch!(Ecto.UUID.generate()) end
  end

  test "authorized? is true for the owner and false for anyone else", %{
    owner: owner,
    stranger: stranger
  } do
    assert {:ok, media} = Media.upload(owner, upload_fixture(png(), content_type: "image/png"))

    assert Media.authorized?(owner, media)
    refute Media.authorized?(stranger, media)
  end

  test "media referenced by a message becomes readable by the conversation member", %{
    owner: owner,
    stranger: stranger
  } do
    assert {:ok, media} = Media.upload(owner, upload_fixture(png(), content_type: "image/png"))
    message = real_message(owner)

    Media.record_message_reference(%{
      media_id: media.id,
      message_id: message.id,
      conversation_id: message.conversation_id,
      user_ids: [owner.id, stranger.id]
    })

    assert Media.authorized?(stranger, media)
  end

  test "a stray reference that names nobody does not widen access", %{
    owner: owner,
    stranger: stranger
  } do
    assert {:ok, media} = Media.upload(owner, upload_fixture(png(), content_type: "image/png"))
    message = real_message(owner)

    Media.record_message_reference(%{
      media_id: media.id,
      message_id: message.id,
      conversation_id: message.conversation_id,
      user_ids: []
    })

    refute Media.authorized?(stranger, media)
    assert Media.authorized?(owner, media)
  end

  # The message_media foreign keys are real now (Task 4), so a reference needs a
  # message in a conversation that actually exist.
  defp real_message(user) do
    peer = create_user("+15550001099")
    {:ok, request} = AwsemChat.Social.request_by_pin(user, peer.pin)
    {:ok, _} = AwsemChat.Social.respond(peer, request.id, :accept)
    {:ok, conversation} = AwsemChat.Social.private_conversation(user, peer)

    {:ok, message} =
      AwsemChat.Chat.send_message(user, conversation.id, %{
        clientOpId: Ecto.UUID.generate(),
        kind: :text,
        payload: %{"v" => 1}
      })

    message
  end

  defp create_user(phone) do
    {:ok, _} = Accounts.request_code(phone)
    {:ok, %{user: user}} = Accounts.verify_code(phone, "123456")
    user
  end

  defp upload_fixture(contents, opts) do
    dir = Path.join(System.tmp_dir!(), "awsemchat-media-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    path = Path.join(dir, "upload.bin")
    File.write!(path, contents)
    on_exit(fn -> File.rm_rf(dir) end)

    %Plug.Upload{
      path: path,
      filename: Keyword.get(opts, :filename, "upload.bin"),
      content_type: Keyword.fetch!(opts, :content_type)
    }
  end

  # Reads through the store the same way the controller streams it.
  defp read_stored(media) do
    {:ok, device} = LocalStore.open(media.storage_path)

    Stream.resource(
      fn -> device end,
      fn device ->
        case IO.binread(device, 1024) do
          :eof -> {:halt, device}
          {:error, reason} -> raise "read failed: #{inspect(reason)}"
          chunk -> {[chunk], device}
        end
      end,
      &File.close/1
    )
    |> Enum.join()
  end

  defp png, do: <<0x89, "PNG\r\n", 0x1A, "\n">> <> :binary.copy(<<0>>, 8)
end
