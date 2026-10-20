defmodule AwsemChat.Repo.Migrations.CreateMoments do
  use Ecto.Migration

  def change do
    create table(:moments, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :conversation_id, references(:conversations, type: :binary_id, on_delete: :delete_all),
        null: false

      add :author_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :kind, :string, null: false
      add :payload, :map, null: false, default: %{}
      add :source_message_id, :binary_id
      add :deleted_at, :utc_datetime

      add :created_at, :utc_datetime_usec, null: false
    end

    create index(:moments, [:conversation_id])
    create index(:moments, [:author_id])
  end
end
