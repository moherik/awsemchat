defmodule AwsemChat.Repo.Migrations.CreateConversationPreferencesAndPositions do
  use Ecto.Migration

  def change do
    create table(:conversation_preferences, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :conversation_id, references(:conversations, type: :binary_id, on_delete: :delete_all),
        null: false

      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :pinned, :boolean, null: false, default: false
      add :pin_order, :integer, null: false, default: 0
      add :muted, :boolean, null: false, default: false
      add :archived, :boolean, null: false, default: false

      timestamps(type: :utc_datetime, updated_at: false)
    end

    create unique_index(:conversation_preferences, [:conversation_id, :user_id])
    create index(:conversation_preferences, [:user_id])

    create table(:conversation_positions, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :conversation_id, references(:conversations, type: :binary_id, on_delete: :delete_all),
        null: false

      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :last_seen_message_id, :binary_id

      timestamps(type: :utc_datetime, updated_at: false)
    end

    create unique_index(:conversation_positions, [:conversation_id, :user_id])
    create index(:conversation_positions, [:user_id])
  end
end
