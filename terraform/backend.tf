terraform {
  backend "s3" {
    bucket       = "coldchain-digital-twin-terraform-state"
    key          = "coldchain-digital-twin/terraform.tfstate"
    region       = "us-west-2"
    encrypt      = true
    use_lockfile = true
  }
}terraform {
  backend "s3" {
    bucket       = "coldchain-digital-twin-terraform-state"
    key          = "coldchain-digital-twin/terraform.tfstate"
    region       = "us-west-2"
    encrypt      = true
    use_lockfile = true
  }
}