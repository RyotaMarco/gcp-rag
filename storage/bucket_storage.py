from typing import Optional

import boto3
from botocore.exceptions import ClientError

from config.config import Config

class BucketStorage:
    def __init__(self, config: type[Config] = Config):
        self.raw_bucket_name = config.RAW_BUCKET_NAME
        self.processed_bucket_name = config.PROCESSED_BUCKET_NAME
        self.localstack_url = config.LOCALSTACK_URL
        self.aws_access_key_id = config.AWS_ACCESS_KEY_ID
        self.aws_secret_access_key = config.AWS_SECRET_ACCESS_KEY
        self.aws_default_region = config.AWS_DEFAULT_REGION
        self.s3 = boto3.client('s3',
                               aws_access_key_id=self.aws_access_key_id,
                               aws_secret_access_key=self.aws_secret_access_key,
                               region_name=self.aws_default_region,
                               endpoint_url=self.localstack_url)
        self._create_bucket()

    def _create_bucket(self) -> None:
        """
        Create a new S3 bucket if it doesn't exist
        parameters:
            bucket_name: Name of the bucket to be created
        """
        for bucket_name in [self.raw_bucket_name, self.processed_bucket_name]:
            try:
                self.s3.create_bucket(Bucket=bucket_name)
            except ClientError as e:
                error_code = e.response['Error']['Code']
                if error_code not in ('BucketAlreadyExists', 'BucketAlreadyOwnedByYou'):
                    raise

    def upload_file(self, content: str, file_name: str, metadata: dict) -> None:
        """
        Upload a file to an S3 bucket
        parameters:
            content: Content of the file to be uploaded
            file_name: S3 object name. If not specified, then file_name is used
        """

        self.s3.put_object(Bucket=self.raw_bucket_name, Key=file_name, Body=content, Metadata=metadata)

    def list_files(self, bucket_name: str, prefix: Optional[str] = None) -> list:
        """
        return: List of all files in the bucket
        parameters:
            prefix: Prefix of the files to be listed
        """
        kwarg = {'Bucket': bucket_name}
        if prefix:
            kwarg['Prefix'] = prefix
        response = self.s3.list_objects_v2(**kwarg)
        return [content['Key'] for content in response.get('Contents', [])]


    def copy_file(self, source_file_path: str) -> None:
        """
        Copy files from the raw bucket to processed bucket
        parameters:
            source_file_path: Path of the file to be copied
        """
        self.s3.copy_object(Bucket=self.processed_bucket_name, CopySource={'Bucket': self.raw_bucket_name, 'Key': source_file_path}, Key=source_file_path)

    def delete_file(self, key: str) -> None:
        """
        Delete a file from the raw bucket
        parameters:
            key: Key of the file to be deleted
        """
        self.s3.delete_object(Bucket=self.raw_bucket_name, Key=key)


    def move_files(self, source_file_path: str):
        """
        Move a file within the raw bucket to the processed bucket
        parameters:
            source_file_path: Path of the file to be moved
        """
        self.copy_file(source_file_path)
        self.delete_file(source_file_path)

    def read_object(self, source_file_path: str):
        """
        Read an object from the raw bucket
        parameters:
            source_file_path: Path of the file to be read
        """
        response = self.s3.get_object(Bucket=self.raw_bucket_name, Key=source_file_path)
        return response['Body'].read().decode('utf-8')