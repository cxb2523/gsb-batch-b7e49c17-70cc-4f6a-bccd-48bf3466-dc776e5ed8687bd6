"""Almacenamiento de clips en un bucket S3 compatible (Cloudflare R2). Opcional."""
import os

VARIABLES = ("SENTRIX_CLIPS_S3_ENDPOINT", "SENTRIX_CLIPS_BUCKET", "SENTRIX_CLIPS_ACCESS_KEY_ID",
             "SENTRIX_CLIPS_SECRET_ACCESS_KEY")


class ObjectStorage:
    def __init__(self, endpoint, bucket, access_key, secret_key):
        import boto3
        from botocore.config import Config
        self.bucket = bucket
        self.client = boto3.client("s3", endpoint_url=endpoint, region_name="auto",
                                   aws_access_key_id=access_key, aws_secret_access_key=secret_key,
                                   config=Config(signature_version="s3v4", retries={"max_attempts": 3}))

    @classmethod
    def from_env(cls):
        values = [os.getenv(name, "").strip() for name in VARIABLES]
        if not all(values):
            return None
        return cls(*values)

    def upload(self, path, key):
        self.client.upload_file(path, self.bucket, key, ExtraArgs={"ContentType": "video/mp4"})

    def delete(self, key):
        # S3/R2 responde OK aunque el objeto ya no exista, así que repetir el borrado es seguro.
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def url(self, key, expires=600):
        # URL temporal: el bucket es privado y el panel nunca recibe credenciales.
        return self.client.generate_presigned_url("get_object", Params={"Bucket": self.bucket, "Key": key},
                                                  ExpiresIn=expires)
