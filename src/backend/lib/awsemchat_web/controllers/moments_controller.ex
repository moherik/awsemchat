defmodule AwsemChatWeb.MomentsController do
  @moduledoc """
  Moments over REST: create, list, promote a message, delete.

  Controllers stay thin. Every rule — the audience boundary (a late joiner
  cannot see a prejoin moment), author-only promotion and delete — lives in
  `AwsemChat.Moments`; this module only translates params into context calls and
  context errors into a code from `AwsemChatWeb.Errors`, exactly like the other
  controllers.
  """

  use AwsemChatWeb, :controller

  alias AwsemChat.Moments
  alias AwsemChatWeb.{Errors, MomentJSON}

  def create(conn, %{"conversationId" => conversation_id} = params) do
    case Moments.create(conn.assigns.current_user, conversation_id, params) do
      {:ok, moment} ->
        conn |> put_status(:created) |> json(%{moment: MomentJSON.data(moment)})

      {:error, reason} ->
        Errors.render(conn, Errors.code_for(reason, changeset: :invalid_payload))
    end
  end

  def list(conn, %{"conversationId" => conversation_id} = params) do
    case Moments.list(conn.assigns.current_user, conversation_id, params) do
      {:ok, page} ->
        json(conn, MomentJSON.page(page))

      {:error, reason} ->
        Errors.render(conn, Errors.code_for(reason, changeset: :invalid_payload))
    end
  end

  # Promoting a message to a moment is `Moments.create/3` with a
  # `sourceMessageId`; the message must be the caller's own (the context refuses
  # anyone else's with `:forbidden`). The wire names it `messageId`, so translate.
  def promote(conn, %{"conversationId" => conversation_id} = params) do
    message_id = params["messageId"] || params["message_id"]
    attrs = Map.put(params, "sourceMessageId", message_id)

    case Moments.create(conn.assigns.current_user, conversation_id, attrs) do
      {:ok, moment} ->
        conn |> put_status(:created) |> json(%{moment: MomentJSON.data(moment)})

      {:error, reason} ->
        Errors.render(conn, Errors.code_for(reason, changeset: :invalid_payload))
    end
  end

  def delete(conn, %{"id" => moment_id}) do
    case Moments.delete(conn.assigns.current_user, moment_id) do
      :ok ->
        json(conn, %{})

      {:error, reason} ->
        Errors.render(conn, Errors.code_for(reason, changeset: :invalid_payload))
    end
  end
end
