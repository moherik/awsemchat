defmodule AwsemChat.Repo.Migrations.CreateChat do
  use Ecto.Migration

  def change do
    create table(:conversations, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :type, :string, null: false
      # Sorted-pair key for private conversations: the same two users always
      # resolve to one row, whichever side started it. Null for circles.
      add :private_key, :string
      add :name, :string
      add :description, :string
      add :avatar_media_id, :binary_id
      add :created_by, references(:users, type: :binary_id, on_delete: :nilify_all)

      timestamps(type: :utc_datetime, updated_at: false)
    end

    create unique_index(:conversations, [:private_key])

    create table(:messages, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :conversation_id, references(:conversations, type: :binary_id, on_delete: :delete_all),
        null: false

      add :sender_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :client_op_id, :binary_id, null: false
      add :kind, :string, null: false
      add :payload, :map, null: false, default: %{}
      add :reply_to_message_id, :binary_id
      add :reply_to_moment_id, :binary_id

      add :created_at, :utc_datetime_usec, null: false
    end

    create index(:messages, [:conversation_id])
    create index(:messages, [:sender_id])
    # Idempotent sends: a retried clientOpId is one row, never two.
    create unique_index(:messages, [:sender_id, :client_op_id])
    # Keyset pagination walks (created_at, id).
    create index(:messages, [:conversation_id, :created_at, :id])

    create table(:deliveries, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :message_id, references(:messages, type: :binary_id, on_delete: :delete_all),
        null: false

      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :delivered_at, :utc_datetime
      add :reachable, :boolean, null: false, default: true

      timestamps(type: :utc_datetime, updated_at: false)
    end

    create index(:deliveries, [:message_id])
    create index(:deliveries, [:user_id])
    create unique_index(:deliveries, [:message_id, :user_id])

    # Foreign keys that media deliberately deferred: message_media was created
    # before messages/conversations existed. The table is empty, so this is a
    # pure constraint addition.
    alter table(:message_media) do
      modify :message_id, references(:messages, type: :binary_id, on_delete: :delete_all)

      modify :conversation_id,
             references(:conversations, type: :binary_id, on_delete: :delete_all)
    end
  end
end
