defmodule AwsemChatWeb.SharedMediaJSON do
  @moduledoc """
  Wire shape for the shared-media grid.

  The context returns its own row shape (snake_case; see
  `Chat.list_shared_media/3`) and this is the one place that names it for the
  client, so the REST shape follows the rest of the API — camelCase keys,
  `Envelope.render/1` being the reference: `mediaId`, `messageId`, `createdAt`,
  `nextCursor`.

  `width`/`height` are passed through as stored. The `media` row's dimension
  columns are currently never populated, so they serialize as `null` rather than
  a guessed size.
  """

  @doc "Renders one shared-media item."
  def data(%{} = item) do
    %{
      mediaId: item.media_id,
      messageId: item.message_id,
      mime: item.mime,
      width: item.width,
      height: item.height,
      createdAt: item.created_at
    }
  end

  @doc "Renders a page of shared media plus its cursor."
  def page(%{items: items, nextCursor: cursor}) do
    %{items: Enum.map(items, &data/1), nextCursor: cursor}
  end
end
