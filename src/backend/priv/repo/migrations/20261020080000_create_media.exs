defmodule AwsemChat.Repo.Migrations.CreateMedia do
  use Ecto.Migration

  def change do
    create table(:media, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :owner_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :mime, :string, null: false
      add :byte_size, :bigint, null: false
      add :width, :integer
      add :height, :integer
      add :storage_path, :string, null: false

      timestamps(type: :utc_datetime)
    end

    create index(:media, [:owner_id])
    create unique_index(:media, [:storage_path])

    create table(:message_media, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :media_id, references(:media, type: :binary_id, on_delete: :delete_all), null: false
      add :message_id, :binary_id, null: false
      add :conversation_id, :binary_id, null: false
      add :user_ids, {:array, :binary_id}, null: false, default: []

      timestamps(type: :utc_datetime)
    end

    create index(:message_media, [:media_id])
    create index(:message_media, [:message_id])
    create unique_index(:message_media, [:media_id, :message_id])
  end
end
