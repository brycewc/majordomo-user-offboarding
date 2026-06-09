# Domo User Management - Bulk Update Ownership of All Objects and Delete User

This repository contains Code Engine packages and a Workflow that allow Domo administrators to bulk update the ownership of all objects owned by a specific user to a new owner, and then delete the original user from the Domo instance.

## Repository Files

### Core Files

- **`majordomo-user-offboarding.js`** - Main Code Engine package containing functions for transferring content ownership and deleting users. Supports 20+ Domo object types including DataSets, Cards, Pages, Workflows, DataFlows, and more.

- **`majordomo-user-offboarding-package-definition.json`** - Package definition file for the main user offboarding package, specifying exported functions and metadata.

- **`domo-product-apis-supplemental.js`** - Supplemental Code Engine package containing helper functions for advanced Domo API operations not available in standard libraries.

- **`domo-product-apis-supplemental-package-definition.json`** - Package definition file for the supplemental APIs package.

- **`workflow-definition.json`** - Workflow definition that orchestrates the user offboarding process, including content transfer, user deletion, and email notifications.

### Automation Scripts

- **`creation-script.js`** - Automated deployment script that creates/updates Code Engine packages, datasets, and workflows in your Domo instance. This script eliminates manual setup by:
  - Searching for existing packages and intelligently updating versions
  - Creating required log and DomoStats datasets
  - Deploying Code Engine packages with proper dependencies
  - Creating and configuring the workflow
  - Personalizing configurations with your user ID and instance URL

## Examples

There are deployed examples of these Code Engine packages and Workflow in the Domo Community instance:

- [Code Engine Package Example - MajorDomo User Offboarding](https://domo-community.domo.com/codeengine/492e45d9-44a5-4601-ae05-91cb8cc4bf4e)
- [Code Engine Package Example - Domo Product APIs Supplemental](https://domo-community.domo.com/codeengine/8e7ddbc6-9df5-438e-91da-577c09f632ce)
- [Workflow Example](https://domo-community.domo.com/workflows/models/6b36e679-1787-451b-8d61-d2327b55fb3f)

## Quick Start (Automated Deployment)

The fastest way to deploy this solution is using the automated creation script:

1. **Prerequisites**:

   - Node.js installed on your machine
   - Domo access token with admin permissions
   - Your Domo instance URL (e.g., `https://your-company.domo.com`)

2. **Clone the repository**:

   ```bash
   git clone https://github.com/brycewc/majordomo-user-offboarding.git
   cd majordomo-user-offboarding
   ```

3. **Run the deployment**:

   ```bash
   node creation-script.js
   ```

   The script will prompt you for:

   - Your Domo instance URL
   - Your Domo access token

4. **What the script does**:

   - Searches for existing packages and updates them (or creates new ones)
   - Creates/finds the Log DataSet for tracking operations
   - Creates/finds the DomoStats Scheduled Reports DataSet
   - Deploys both Code Engine packages with latest versions
   - Creates the Workflow with personalized configuration
   - Replaces hardcoded IDs with your user ID and instance URL

5. **Post-deployment**:
   - Update the Send Email to MajorDomo step of the workflow. Replace the cardId and column placeholders in the body to work with a card built on the log dataset in your instance
   - Once you're satisfied with the workflow, deploy it
   - Configure workflow triggers and notifications

## Manual Setup (Alternative)

If you prefer manual setup or need to customize the deployment:

1. Copy the code from `majordomo-user-offboarding.js` into a new Code Engine package in your Domo instance.
2. Copy the code from `domo-product-apis-supplemental.js` into another Code Engine package.
3. Configure the two DataSet ID variables at the top of `majordomo-user-offboarding.js`:
   1. **Log DataSet**: Can be a webform DataSet with columns: `userId`, `newOwnerId`, `type`, `id`, `date`, `status`, `notes`.
   2. **Scheduled Reports DataSet**: The DomoStats Scheduled Reports DataSet that contains scheduled reports in your instance.
4. Deploy both Code Engine packages.
5. Create a Workflow using the deployed Code Engine packages and a trigger of your choice. You can use `workflow-definition.json` as reference.
6. The Code Engine function `transferContent` requires two input parameters:
   1. `userIds`: An array of user IDs whose objects you want to reassign and who you want to delete.
   2. `newOwnerIds`: An array of user IDs who will become the new owners of the objects.
7. Update the email step as desired.
8. Save and deploy the Workflow.

## Supported Object Types

The function currently supports the following Domo object types for ownership reassignment:

- Accounts
- AI Models
- AI Projects
- Alerts
- App Studio Apps
- AppDB Collections
- Approval Templates
- Cards
- Code Engine Packages
- Custom Apps
- DataFlows
- DataSets
- Domo Everywhere Subscriptions
- FileSets
- Functions (Beast Modes and Variables)
- Goals
- Groups
- Jupyter Workspaces
- Metrics (Automated Insights)
- Pages
- Pending Approvals
- Projects and Tasks
- Sandbox Repositories
- Scheduled Reports _(using DomoStats DataSet)_
- Task Center Queues
- Task Center Tasks
- Workflows
- Worksheets
- Workspaces

## Unsupported Object Types

- Domo Everywhere Publications (still gets logged but not reassigned)
- Sent Back Approvals (still gets logged but not reassigned)
