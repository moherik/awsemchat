defmodule AwsemChat.Media.Store do
  @moduledoc """
  Where uploaded bytes live.

  This is the seam the design doc points at: local disk today, object storage
  later, one module swapped in config without the Media context or the
  controller changing.
  """

  @typedoc "Storage key for one stored object. Opaque to callers; never derived from a client filename."
  @type path :: String.t()

  @doc """
  Persists the uploaded bytes and returns their storage key.

  Implementations must generate the key themselves. A `Plug.Upload`'s
  `filename` is attacker-controlled and must never reach the filesystem.
  """
  @callback put(upload :: Plug.Upload.t()) :: {:ok, path()} | {:error, term()}

  @doc "Opens a stored object for reading."
  @callback open(path()) :: {:ok, IO.device()} | {:error, term()}

  @doc """
  Removes a stored object.

  Compensating action for a failed metadata insert, so a database error never
  leaves bytes behind that no row points at.
  """
  @callback delete(path()) :: :ok | {:error, term()}
end
