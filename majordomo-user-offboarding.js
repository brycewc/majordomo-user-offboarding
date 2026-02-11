/* eslint require-atomic-updates: 0 */
const codeengine = require('codeengine');

const logDatasetId = '83dec9f2-206b-445a-90ea-b6a368b3157d'; // Format: userId,newOwnerId,type,id,date,status,notes
const domostatsScheduledReportsDatasetId =
	'b7306441-b8a7-481c-baaf-4fffadb0ff61'; // https://www.domo.com/appstore/connector/domostats/datasets

class Helpers {
	/**
	 * Helper function to handle API requests and errors
	 * @param {text} method - The HTTP method
	 * @param {text} url - The endpoint URL
	 * @param {Object} [body=null] - The request body
	 * @param {Object} [headers=null] - The request headers
	 * @param {text} [content='application/json'] - Request body content type
	 * @returns {Object} The response data
	 * @throws {Error} If the request fails
	 */
	static async handleRequest(
		method,
		url,
		body = null,
		headers = null,
		contentType = 'application/json'
	) {
		try {
			return await codeengine.sendRequest(
				method,
				url,
				body,
				headers,
				contentType
			);
		} catch (error) {
			console.error(
				`Error with ${method} request to ${url}\nError:\n${JSON.stringify(
					error
				)}\nPayload:\n${JSON.stringify(body, null, 2)}`
			);
			// throw error;
		}
	}
}

const { handleRequest } = Helpers;

async function getUserName(userId) {
	const url = `/api/content/v3/users/${userId}`;
	const user = await handleRequest('GET', url);
	return user.displayName || null;
}

/**
 * Retrieve all active sessions and delete those belonging to the specified user.
 *
 * @param {string} userId - The Domo user ID for which to delete active sessions.
 * @returns {Promise<void>} Resolves when all user's sessions are deleted or rejects on error.
 */
async function deleteUserSessions(userId) {
	const url = '/api/sessions/v1/admin?limit=99999999';
	// Fetch all sessions (potentially large number depending on 'limit')
	const response = await handleRequest('GET', url);

	// Find sessions assigned to the specified user
	const sessionsToDelete = response.filter((s) => s.userId === userId);
	if (sessionsToDelete.length > 0) {
		// Delete all sessions concurrently and wait for completion
		await Promise.all(sessionsToDelete.map((s) => deleteSession(s.id)));
	}
}

/**
 * Retrieve all active sessions and delete those belonging to the specified users.
 *
 * @param {number[]} userIds - Array of Domo user IDs for which to delete active sessions.
 * @returns {Promise<void>} Resolves when all users' sessions are deleted or rejects on error.
 */
async function deleteUsersSessions(userIds) {
	const url = '/api/sessions/v1/admin?limit=99999999';
	// Fetch all sessions (potentially large number depending on 'limit')
	const response = await handleRequest('GET', url);

	// Find sessions assigned to any of the specified users
	const sessionsToDelete = response.filter((s) => userIds.includes(s.userId));
	if (sessionsToDelete.length > 0) {
		// Delete all sessions concurrently and wait for completion
		await Promise.all(sessionsToDelete.map((s) => deleteSession(s.id)));
	}
}

/**
 * Delete a session by its session ID.
 *
 * @param {string} sessionId - The ID of the session to delete.
 * @returns {Promise<void>} Resolves after session deletion, or logs error if deletion fails.
 */
async function deleteSession(sessionId) {
	const url = `api/sessions/v1/admin/${sessionId}`;

	await handleRequest('DELETE', url);
}

/**
 * Delete a user by its ID.
 *
 * @param {string} userId - The ID of the user to delete.
 * @returns {Promise<void>} Resolves after session deletion, or logs error if deletion fails.
 */
async function deleteUser(userId) {
	const url = `/api/identity/v1/users/${userId}`;

	await handleRequest('DELETE', url);
}

async function appendToDataset(csvValues, datasetId = logDatasetId) {
	const uploadUrl = `api/data/v3/datasources/${datasetId}/uploads`;
	const uploadBody = {
		action: 'APPEND',
		message: 'Uploading',
		appendId: 'latest'
	};
	// Start upload session
	const { uploadId } = await handleRequest('POST', uploadUrl, uploadBody);

	// Upload data part
	const partsUrl = uploadUrl + `/${uploadId}/parts/1`;
	//const partsUrl = UPLOADS_PARTS_URL.replace(':id', dataset).replace(':uploadId', uploadId);
	await handleRequest('PUT', partsUrl, csvValues, null, 'text/csv');

	// Commit upload
	const commitUrl = uploadUrl + `/${uploadId}/commit`;
	//const commitUrl = UPLOADS_COMMIT_URL.replace(':id', dataset).replace(':uploadId', uploadId);
	const commitBody = {
		index: true,
		appendId: 'latest',
		message: 'Append successful'
	};

	return await handleRequest('PUT', commitUrl, commitBody);
}

async function logTransfers(
	userId,
	newOwnerId,
	type,
	ids,
	status = 'TRANSFERRED',
	notes = null
) {
	const BATCH_SIZE = 50;
	let batch = [];
	const date = new Date().toISOString().slice(0, -5); // Format: YYYY-MM-DDTHH:mm:ss

	for (const id of ids) {
		batch.push(
			`${userId},${newOwnerId},${type},${id},${date},${status},${notes}`
		);

		if (batch.length >= BATCH_SIZE) {
			try {
				await appendToDataset(batch.join('\n') + '\n', logDatasetId);
			} catch (error) {
				console.error('Logging failed:', error);
			}
			batch = [];
		}
	}

	if (batch.length > 0) {
		try {
			await appendToDataset(batch.join('\n') + '\n', logDatasetId);
		} catch (error) {
			console.error('Logging failed:', error);
		}
	}
}

//---------------------------TRANSFER-----------------------//

async function transferContent(userId, newOwnerId, objectsToTransfer = []) {
	let currentPeriodId = await getCurrentPeriod();

	// Handle null or undefined by converting to empty array
	if (!objectsToTransfer) {
		objectsToTransfer = [];
	}

	// Parse objects by type if specific objects are provided
	const objectsByType = {};
	if (objectsToTransfer.length > 0) {
		for (const obj of objectsToTransfer) {
			if (!objectsByType[obj.type]) {
				objectsByType[obj.type] = [];
			}
			objectsByType[obj.type].push(obj.id);
		}
	}

	await Promise.all([
		transferDatasets(userId, newOwnerId, objectsByType['DATA_SOURCE'] || []),

		transferDataflows(userId, newOwnerId, objectsByType['DATAFLOW_TYPE'] || []),

		transferCards(userId, newOwnerId, objectsByType['CARD'] || []),

		transferAlerts(userId, newOwnerId, objectsByType['ALERT'] || []),

		transferWorkflows(
			userId,
			newOwnerId,
			objectsByType['WORKFLOW_MODEL'] || []
		),

		transferTaskCenterQueues(
			userId,
			newOwnerId,
			objectsByType['HOPPER_QUEUE'] || []
		),

		transferTaskCenterTasks(
			userId,
			newOwnerId,
			objectsByType['HOPPER_TASK'] || []
		),

		transferAppStudioApps(userId, newOwnerId, objectsByType['DATA_APP'] || []),

		transferPages(userId, newOwnerId, objectsByType['PAGE'] || []),

		transferScheduledReports(
			userId,
			newOwnerId,
			objectsByType['REPORT_SCHEDULE'] || []
		),

		transferGoals(
			userId,
			newOwnerId,
			currentPeriodId,
			objectsByType['GOAL'] || []
		),

		transferGroups(userId, newOwnerId, objectsByType['GROUP'] || []),

		transferAppDbCollections(
			userId,
			newOwnerId,
			objectsByType['COLLECTION'] || []
		),

		transferFunctions(userId, newOwnerId, [
			...(objectsByType['BEAST_MODE_FORMULA'] || []),
			...(objectsByType['VARIABLE'] || [])
		]),

		transferAccounts(userId, newOwnerId, objectsByType['ACCOUNT'] || []),

		transferJupyterWorkspaces(
			userId,
			newOwnerId,
			objectsByType['DATA_SCIENCE_NOTEBOOK'] || []
		),

		transferCodeEnginePackages(
			userId,
			newOwnerId,
			objectsByType['CODEENGINE_PACKAGE'] || []
		),

		transferFilesets(userId, newOwnerId, objectsByType['FILESET'] || []),

		getPublications(userId, newOwnerId, objectsByType['PUBLICATION'] || []),

		transferSubscriptions(
			userId,
			newOwnerId,
			objectsByType['SUBSCRIPTION'] || []
		),

		transferRepositories(userId, newOwnerId, objectsByType['REPOSITORY'] || []),

		...(objectsToTransfer.length === 0
			? [transferApprovals(userId, newOwnerId)]
			: []),

		...(objectsToTransfer.length === 0
			? [transferApprovalTemplates(userId, newOwnerId)]
			: []),

		transferCustomApps(userId, newOwnerId, [
			...(objectsByType['APP'] || []),
			...(objectsByType['RYUU_APP'] || [])
		]),

		transferAiModels(userId, newOwnerId, objectsByType['AI_MODEL'] || []),

		transferAiProjects(userId, newOwnerId, objectsByType['AI_PROJECT'] || []),

		transferProjectsAndTasks(userId, newOwnerId, [
			...(objectsByType['PROJECT_TASK'] || []),
			...(objectsByType['PROJECT'] || [])
		]),

		transferMetrics(userId, newOwnerId, objectsByType['METRIC'] || [])
	]);
}

//-------------------------DataSets--------------------------//

async function transferDatasets(userId, newOwnerId, filteredIds = []) {
	const userName = await getUserName(userId);

	let allIds = [];

	if (filteredIds.length > 0) {
		// Use the provided filtered list
		allIds = filteredIds;
	} else {
		// Use existing get logic
		const endpoint = '/api/data/ui/v3/datasources/ownedBy';
		const data = [
			{
				id: userId.toString(),
				type: 'USER'
			}
		];

		const response = await handleRequest('POST', endpoint, data);
		if (response && response.length > 0) {
			if (response[0].dataSourceIds && response[0].dataSourceIds.length > 0) {
				allIds = response[0].dataSourceIds;
			}
		}
	}

	if (allIds.length > 0) {
		// Process datasets in batches
		const batchSize = 50;
		for (let i = 0; i < allIds.length; i += batchSize) {
			const chunk = allIds.slice(i, i + batchSize);
			// Update owner
			const body = {
				type: 'DATA_SOURCE',
				ids: chunk,
				userId: newOwnerId
			};
			await handleRequest('POST', '/api/data/v1/ui/bulk/reassign', body);
			// Add new tags
			const tagsBody = {
				bulkItems: {
					ids: chunk,
					type: 'DATA_SOURCE'
				},
				tags: [`From ${userName}`]
			};
			await handleRequest('POST', '/api/data/v1/ui/bulk/tag', tagsBody);
		}

		await logTransfers(userId, newOwnerId, 'DATA_SOURCE', allIds);
	}
}

//----------------------------DataFlows-----------------------//

async function transferDataflows(userId, newOwnerId, filteredIds = []) {
	const userName = await getUserName(userId);

	let allIds = [];

	if (filteredIds.length > 0) {
		// Use the provided filtered list
		allIds = filteredIds;
	} else {
		// Use existing get logic
		const count = 100;
		let offset = 0;
		let moreData = true;

		while (moreData) {
			const data = {
				entities: ['DATAFLOW'],
				filters: [
					{
						field: 'owned_by_id',
						filterType: 'term',
						value: userId
					}
				],
				query: '*',
				count: count,
				offset: offset
			};

			const response = await handleRequest(
				'POST',
				'/api/search/v1/query',
				data
			);

			if (response.searchObjects && response.searchObjects.length > 0) {
				// Extract ids and append to list
				const dataflows = response.searchObjects;
				const ids = dataflows.map((dataflow) => dataflow.databaseId);
				allIds.push(...ids);

				// Increment offset to get next page
				offset += count;

				// If less than pageSize returned, this is the last page
				if (response.searchObjects.length < count) {
					moreData = false;
				}
			} else {
				// No more data returned, stop loop
				moreData = false;
			}
		}
	}

	if (allIds.length > 0) {
		const url = '/api/dataprocessing/v1/dataflows/bulk/patch';

		// Note: We can't easily get existing tags when using filtered IDs, so we'll skip tag cleanup for filtered transfers
		if (filteredIds.length === 0) {
			// Only do tag cleanup when doing full transfer (not filtered)
			const tags = []; // This would need to be retrieved per dataflow, which is complex
			if (tags.length > 0) {
				const oldTags = tags.filter((tag) => tag.startsWith('From')) || [];

				// Remove tags
				if (oldTags.length > 0) {
					const removetagsBody = {
						dataFlowIds: allIds,
						tagNames: oldTags
					};
					await handleRequest(
						'PUT',
						'/api/dataprocessing/v1/dataflows/bulk/tag/delete',
						removetagsBody
					);
				}
			}
		}

		// Log transfers
		await logTransfers(userId, newOwnerId, 'DATAFLOW_TYPE', allIds);

		// Update owner
		const body = {
			dataFlowIds: allIds,
			responsibleUserId: newOwnerId
		};
		await handleRequest('PUT', url, body);

		// Add new tags in batches of 50
		for (let i = 0; i < allIds.length; i += 50) {
			const chunk = allIds.slice(i, i + 50);
			const addTagsBody = {
				dataFlowIds: chunk,
				tagNames: [`From ${userName}`]
			};
			await handleRequest(
				'PUT',
				'/api/dataprocessing/v1/dataflows/bulk/tag',
				addTagsBody
			);
		}
	}
}

//----------------------Cards-------------------------//

async function transferCards(userId, newOwnerId, filteredIds = []) {
	const url = '/api/search/v1/query';

	let allIds = [];

	if (filteredIds.length > 0) {
		// Use the provided filtered list
		allIds = filteredIds;
	} else {
		// Use existing discovery logic
		let offset = 0;
		const count = 50;
		let moreData = true;

		while (moreData) {
			const data = {
				count: count,
				offset: offset,
				combineResults: false,
				query: '*',
				filters: [
					{
						name: 'OWNED_BY_ID',
						field: 'owned_by_id',
						facetType: 'user',
						value: `${userId}:USER`,
						filterType: 'term'
					}
				],
				entityList: [['card']]
			};

			const response = await handleRequest('POST', url, data);

			if (response.searchObjects && response.searchObjects.length > 0) {
				const ids = response.searchObjects.map((card) => card.databaseId);
				allIds.push(...ids);

				// Increment offset to get next page
				offset += count;

				// If less than pageSize returned, this is the last page
				if (response.searchObjects.length < count) {
					moreData = false;
				}
			} else {
				// No more data returned, stop loop
				moreData = false;
			}
		}
	}

	if (allIds.length > 0) {
		let body = {
			cardIds: allIds,
			cardOwners: [
				{
					id: newOwnerId,
					type: 'USER'
				}
			],
			note: '',
			sendEmail: false
		};

		await handleRequest('POST', '/api/content/v1/cards/owners/add', body);

		body.cardOwners = [
			{
				id: userId,
				type: 'USER'
			}
		];

		// await handleRequest('POST', '/api/content/v1/cards/owners/remove', body); // Removing because their ownership will be removed when they are deleted

		await logTransfers(userId, newOwnerId, 'CARD', allIds);
	}
}

// -----------------Alerts--------------------------//
/**
 * Get alerts a user is subscribed to
 *
 * @param {string} userId - The ID of the user to get alerts for.
 * @returns {List<int>} List of alert IDs the user is subscribed to.
 */
async function transferAlerts(userId, newOwnerId, filteredIds = []) {
	let alerts = [];

	if (filteredIds.length > 0) {
		// Use the provided filtered list
		alerts = filteredIds;
	} else {
		// Use existing discovery logic
		let moreData = true;
		let offset = 0;
		const limit = 50;

		while (moreData) {
			const response = await handleRequest(
				'GET',
				`/api/social/v4/alerts?ownerId=${userId}&limit=${limit}&offset=${offset}`
			);

			if (response.length > 0) {
				// Extract ids and append to list
				const ids = response.map((alert) => alert.id);
				alerts.push(...ids);

				// Increment offset to get next page
				offset += limit;

				// If less than pageSize returned, this is the last page
				if (response.length < limit) {
					moreData = false;
				}
			} else {
				// No more data returned, stop loop
				moreData = false;
			}
		}
	}

	if (alerts.length > 0) {
		for (let i = 0; i < alerts.length; i++) {
			const body = {
				id: alerts[i],
				owner: newOwnerId
			};
			const url = `/api/social/v4/alerts/${alerts[i]}`;
			await handleRequest('PATCH', url, body);
		}

		await logTransfers(userId, newOwnerId, 'ALERT', alerts);
	}
}

//---------------------------Workflows--------------------------------//
/**
 * Get Workflows owned by given user ID and transfer ownership by updating the full workflow object
 *
 * @param {string} userId - The ID of the owner to search for.
 * @param {string} newOwnerId - The ID of the new owner.
 */
async function transferWorkflows(userId, newOwnerId, filteredIds = []) {
	let workflowIds = [];

	if (filteredIds.length > 0) {
		// Use the provided filtered list
		workflowIds = filteredIds;
	} else {
		// Use existing discovery logic
		const count = 100;
		let offset = 0;
		let moreData = true;

		while (moreData) {
			const data = {
				query: '*',
				entityList: [['workflow_model']],
				count: count,
				offset: offset,
				filters: [
					{
						facetType: 'user',
						filterType: 'term',
						field: 'owned_by_id',
						value: `${userId}:USER`
					}
				]
			};

			const response = await handleRequest(
				'POST',
				'/api/search/v1/query',
				data
			);

			if (response.searchObjects && response.searchObjects.length > 0) {
				// Extract ids and append to list
				const ids = response.searchObjects.map((workflow) => workflow.uuid);
				workflowIds.push(...ids);

				// Increment offset to get next page
				offset += count;

				// If less than pageSize returned, this is the last page
				if (response.searchObjects.length < count) {
					moreData = false;
				}
			} else {
				// No more data returned, stop loop
				moreData = false;
			}
		}
	}

	if (workflowIds.length > 0) {
		// Process each workflow individually by fetching the full object and updating it
		for (let i = 0; i < workflowIds.length; i++) {
			const workflowId = workflowIds[i];

			// Get the full workflow object
			const workflow = await handleRequest(
				'GET',
				`/api/workflow/v1/models/${workflowId}`
			);

			// Update the owner property
			workflow.owner = newOwnerId.toString();

			// Save the workflow with the updated owner
			await handleRequest(
				'PUT',
				`/api/workflow/v1/models/${workflowId}`,
				workflow
			);
		}

		await logTransfers(userId, newOwnerId, 'WORKFLOW_MODEL', workflowIds);
	}
}

//--------------------------Task Center Queues--------------------------//

async function transferTaskCenterQueues(userId, newOwnerId, filteredIds = []) {
	let queues = [];

	if (filteredIds.length > 0) {
		// Use the provided filtered list
		queues = filteredIds;
	} else {
		// Use existing discovery logic
		const count = 100;
		let offset = 0;
		let moreData = true;

		while (moreData) {
			const data = {
				query: '*',
				entityList: [['queue']],
				count: count,
				offset: offset,
				filters: [
					{
						facetType: 'user',
						filterType: 'term',
						field: 'owned_by_id',
						value: `${userId}:USER`
					}
				]
			};

			const response = await handleRequest(
				'POST',
				'/api/search/v1/query',
				data
			);

			if (response.searchObjects && response.searchObjects.length > 0) {
				// Extract ids and append to list
				const ids = response.searchObjects.map((queue) => queue.uuid);
				queues.push(...ids);

				// Increment offset to get next page
				offset += count;

				// If less than pageSize returned, this is the last page
				if (response.searchObjects.length < count) {
					moreData = false;
				}
			} else {
				// No more data returned, stop loop
				moreData = false;
			}
		}
	}

	if (queues.length > 0) {
		for (let i = 0; i < queues.length; i++) {
			await handleRequest(
				'PUT',
				`/api/queues/v1/${queues[i]}/owner/${newOwnerId}`,
				null,
				{ 'Content-Type': 'application/json' }
			);
		}

		await logTransfers(userId, newOwnerId, 'HOPPER_QUEUE', queues);
	}
}

//--------------------------Task Center Tasks--------------------------//

async function transferTaskCenterTasks(userId, newOwnerId, filteredIds = []) {
	let tasks = [];

	if (filteredIds.length > 0) {
		// Use the provided filtered list - for tasks we need to fetch queue info
		const taskDetails = [];
		for (const taskId of filteredIds) {
			// We'd need to find the queue for each task, but this is complex
			// For now, just store the ID and handle the transfer
			taskDetails.push({ id: taskId, queueId: null });
		}
		tasks = taskDetails;
	} else {
		// Use existing discovery logic
		let offset = 0;
		const limit = 100;
		let moreData = true;

		while (moreData) {
			const response = await handleRequest(
				'POST',
				`/api/queues/v1/tasks/list?limit=${limit}&offset=${offset}`,
				{ assignedTo: [userId], status: ['OPEN'] }
			);

			if (response && response.length > 0) {
				// Extract ids and append to list
				const ids = response.map((task) => ({
					id: task.id,
					queueId: task.queueId
				}));
				tasks.push(...ids);

				// Increment offset to get next page
				offset += limit;

				// If less than pageSize returned, this is the last page
				if (response.length < limit) {
					moreData = false;
				}
			} else {
				// No more data returned, stop loop
				moreData = false;
			}
		}
	}

	if (tasks.length > 0) {
		const taskIdList = [];

		for (let i = 0; i < tasks.length; i++) {
			if (tasks[i].queueId) {
				const url = `/api/queues/v1/${tasks[i].queueId}/tasks/${tasks[i].id}/assign`;
				const body = {
					userId: newOwnerId,
					type: 'USER',
					taskIds: [tasks[i].id]
				};
				await handleRequest('PUT', url, body);
			}
			taskIdList.push(tasks[i].id);
		}

		await logTransfers(userId, newOwnerId, 'HOPPER_TASK', taskIdList);
	}
}

//------------------------------------App Studio--------------------------//

async function transferAppStudioApps(userId, newOwnerId, filteredIds = []) {
	let allApps = [];

	if (filteredIds.length > 0) {
		// Use the provided filtered list
		allApps = filteredIds.map((id) => id.toString());
	} else {
		// Use existing discovery logic
		const limit = 30;
		let skip = 0;
		let moreData = true;
		const data = {};

		while (moreData) {
			const url = `/api/content/v1/dataapps/adminsummary?limit=${limit}&skip=${skip}`;
			const response = await handleRequest('POST', url, data);

			if (
				response.dataAppAdminSummaries &&
				response.dataAppAdminSummaries.length > 0
			) {
				// Extract ids and append to list
				const apps = response.dataAppAdminSummaries
					.filter((item) => item.owners.some((owner) => owner.id == userId))
					.map((item) => item.dataAppId.toString());
				allApps.push(...apps);

				// Increment offset to get next page
				skip += limit;

				// If less than pageSize returned, this is the last page
				if (response.dataAppAdminSummaries.length < limit) {
					moreData = false;
				}
			} else {
				// No more data returned, stop loop
				moreData = false;
			}
		}
	}

	if (allApps.length > 0) {
		const addBody = {
			note: '',
			entityIds: allApps,
			owners: [{ type: 'USER', id: parseInt(newOwnerId) }],
			sendEmail: false
		};

		await handleRequest('PUT', '/api/content/v1/dataapps/bulk/owners', addBody);

		const removeBody = {
			entityIds: allApps,
			owners: [{ type: 'USER', id: userId }]
		};

		await handleRequest(
			'POST',
			'/api/content/v1/dataapps/bulk/owners/remove',
			removeBody
		);

		await logTransfers(userId, newOwnerId, 'DATA_APP', allApps);
	}
}

//-----------------------------------Pages------------------------------//

async function transferPages(userId, newOwnerId, filteredIds = []) {
	let allPages = [];

	if (filteredIds.length > 0) {
		// Use the provided filtered list
		allPages = filteredIds;
	} else {
		// Use existing discovery logic
		let skip = 0;
		const limit = 50;
		let moreData = true;

		while (moreData) {
			const url = `/api/content/v1/pages/adminsummary?limit=${limit}&skip=${skip}`;
			const data = {
				addPageWithNoOwner: false,
				includePageOwnerClause: 1,
				ownerIds: [userId],
				groupOwnerIds: [],
				orderBy: 'pageTitle',
				ascending: true
			};

			const response = await handleRequest('POST', url, data);

			if (
				response.pageAdminSummaries &&
				response.pageAdminSummaries.length > 0
			) {
				// Extract ids and append to list
				const pages = response.pageAdminSummaries.map((page) => page.pageId);
				allPages.push(...pages);

				// Increment skip to get next page
				skip += limit;

				// If less than pageSize returned, this is the last page
				if (response.pageAdminSummaries.length < limit) {
					moreData = false;
				}
			} else {
				// No more data returned, stop loop
				moreData = false;
			}
		}
	}

	if (allPages.length > 0) {
		const body = {
			owners: [{ id: newOwnerId, type: 'USER' }],
			pageIds: allPages
		};

		await handleRequest('PUT', '/api/content/v1/pages/bulk/owners', body);

		const removeBody = {
			owners: [
				{
					id: parseInt(userId),
					type: 'USER'
				}
			],
			pageIds: allPages
		};

		await handleRequest(
			'POST',
			'/api/content/v1/pages/bulk/owners/remove',
			removeBody
		);
		await logTransfers(userId, newOwnerId, 'PAGE', allPages);
	}
}

//---------------------------------Scheduled Reports--------------------------------//

async function transferScheduledReports(userId, newOwnerId, filteredIds = []) {
	let reportIds = [];

	if (filteredIds.length > 0) {
		// Use the provided filtered list
		reportIds = filteredIds;
	} else {
		// Use existing discovery logic
		const url = `api/query/v1/execute/${domostatsScheduledReportsDatasetId}`;
		const body = {
			querySource: 'data_table',
			useCache: true,
			query: {
				columns: [
					{
						exprType: 'COLUMN',
						column: 'Report Id'
					}
				],
				limit: {
					limit: 10000,
					offset: 0
				},
				orderByColumns: [],
				groupByColumns: [],
				where: {
					not: false,
					exprType: 'IN',
					leftExpr: {
						exprType: 'COLUMN',
						column: 'Owner Id'
					},
					selectSet: [
						{
							exprType: 'STRING_VALUE',
							value: userId
						}
					]
				},
				having: null
			},
			context: {
				calendar: 'StandardCalendar',
				features: {
					PerformTimeZoneConversion: true,
					AllowNullValues: true,
					TreatNumbersAsStrings: true
				}
			},
			// Used for Views Explorer, not the regular Data table
			viewTemplate: null,
			tableAliases: null
		};

		const response = await handleRequest('POST', url, body);
		const reports = response.rows;
		reportIds = reports.map((r) => r[0]);
	}

	if (reportIds.length > 0) {
		for (let i = 0; i < reportIds.length; i++) {
			const endpoint = `/api/content/v1/reportschedules/${reportIds[i]}`;

			let report = await handleRequest('GET', endpoint);
			let reportBody = {
				id: report.id,
				ownerId: newOwnerId,
				schedule: report.schedule,
				subject: report.subject,
				viewId: report.viewId
			};
			report.ownerId = newOwnerId;
			await handleRequest('PUT', endpoint, reportBody);
		}
		await logTransfers(userId, newOwnerId, 'REPORT_SCHEDULE', reportIds);
	}
}

//---------------------------------------------Goals------------------------------------------------//

async function getCurrentPeriod() {
	const response = await handleRequest(
		'GET',
		'/api/social/v1/objectives/periods?all=true'
	);
	const currentPeriod = response.find((period) => period.current);
	return currentPeriod.id;
}

async function transferGoals(userId, newOwnerId, periodId) {
	const url = `api/social/v2/objectives/profile?filterKeyResults=false&includeSampleGoal=false&periodId=${periodId}&ownerId=${userId}`;

	const goals = await handleRequest('GET', url);
	if (goals && goals.length > 0) {
		for (let i = 0; i < goals.length; i++) {
			const goalUrl = `/api/social/v1/objectives/${goals[i].id}`;

			goals[i].ownerId = newOwnerId;
			goals[i].owners = [
				{
					ownerId: newOwnerId,
					ownerType: 'USER',
					primary: false
				}
			];

			const body = goals[i];

			await handleRequest('PUT', goalUrl, body);
		}
		await logTransfers(
			userId,
			newOwnerId,
			'GOAL',
			goals.map((goal) => goal.id)
		);
	}
}

//-----------------------------------------Groups----------------------------------------//

async function transferGroups(userId, newOwnerId, filteredIds = []) {
	let allGroupIds = [];

	if (filteredIds.length > 0) {
		// Use the provided filtered list
		allGroupIds = filteredIds;
	} else {
		// Use existing discovery logic
		const limit = 100;
		let offset = 0;
		let moreData = true;

		while (moreData) {
			const url = `/api/content/v2/groups/grouplist?owner=${userId}&limit=${limit}&offset=${offset}`;
			const response = await handleRequest('GET', url);

			if (response && response.length > 0) {
				// Extract ids and append to list
				const groupIds = response
					.filter((group) => group.owners.some((owner) => owner.id === userId))
					.map((group) => group.id);
				allGroupIds.push(...groupIds);

				// Increment offset to get next page
				offset += limit;

				// If less than pageSize returned, this is the last page
				if (response.length < limit) {
					moreData = false;
				}
			} else {
				// No more data returned, stop loop
				moreData = false;
			}
		}
	}

	if (allGroupIds.length > 0) {
		const body = allGroupIds.map((group) => ({
			groupId: group,
			addOwners: [{ type: 'USER', id: newOwnerId }],
			removeOwners: [{ type: 'USER', id: userId }]
		}));

		await handleRequest('PUT', '/api/content/v2/groups/access', body);

		await logTransfers(userId, newOwnerId, 'GROUP', allGroupIds);
	}
}

//-----------------------------------------AppDB--------------------------------//
// Datastore owner cannot be updated

async function transferAppDbCollections(userId, newOwnerId, filteredIds = []) {
	let allCollectionIds = [];

	if (filteredIds.length > 0) {
		// Use the provided filtered list
		allCollectionIds = filteredIds;
	} else {
		// Use existing discovery logic
		let moreData = true;
		let pageNumber = 1;
		const pageSize = 100;

		while (moreData) {
			const data = {
				collectionFilteringList: [
					{
						filterType: 'ownedby',
						comparingCriteria: 'equals',
						typedValue: userId
					}
				],
				pageSize: pageSize,
				pageNumber: pageNumber
			};

			const response = await handleRequest(
				'POST',
				'/api/datastores/v1/collections/query',
				data
			);

			if (response.collections && response.collections.length > 0) {
				const collectionIds = response.collections.map(
					(collection) => collection.id
				);
				allCollectionIds.push(...collectionIds);

				// Increment page number to get next page
				pageNumber++;

				// If less than pageSize returned, this is the last page
				if (response.collections.length < pageSize) {
					moreData = false;
				}
			} else {
				// No more data returned, stop loop
				moreData = false;
			}
		}
	}

	if (allCollectionIds.length > 0) {
		for (let i = 0; i < allCollectionIds.length; i++) {
			const url = `/api/datastores/v1/collections/${allCollectionIds[i]}`;
			const body = { id: allCollectionIds[i], owner: newOwnerId };
			await handleRequest('PUT', url, body);
		}
		await logTransfers(userId, newOwnerId, 'COLLECTION', allCollectionIds);
	}
}

//--------------------------Functions (Beast Modes and Variables)-------------------------//
// Need to update to delete Beast Modes on deleted DataSets that have 0 dependencies
// Helper: verify referenced resources exist; if not, drop links before update
async function resourceExists(type, id) {
	try {
		if (type === 'CARD') {
			await handleRequest('GET', `/api/content/v1/cards/${id}/details`);
			return true;
		}
		if (type === 'DATA_SOURCE' || type === 'DATASET') {
			await handleRequest('GET', `/api/data/v3/datasources/${id}`);
			return true;
		}
		// For other types, don't validate here
		return true;
	} catch (_err) {
		return false;
	}
}

async function sanitizeLinks(links) {
	if (!Array.isArray(links) || links.length === 0)
		return { valid: [], invalid: [] };
	const valid = [];
	const invalid = [];
	for (const link of links) {
		try {
			const res = link && link.resource ? link.resource : null;
			if (
				res &&
				res.id != null &&
				(res.type === 'CARD' ||
					res.type === 'DATA_SOURCE' ||
					res.type === 'DATASET')
			) {
				const exists = await resourceExists(res.type, res.id);
				if (!exists) {
					invalid.push(link);
					continue; // skip invalid references
				}
			}
			valid.push(link);
		} catch (_e) {
			// On unexpected shape, drop link
			invalid.push(link);
		}
	}
	return { valid, invalid };
}
async function transferFunctions(userId, newOwnerId, filteredIds = []) {
	let allFunctionIds = [];

	if (filteredIds.length > 0) {
		// Use the provided filtered list - we need to fetch each function individually
		const bulkUrl = '/api/query/v1/functions/bulk/template';
		const beastModes = [];
		const variables = [];
		const deletedBeastModes = [];
		const deletedVariables = [];

		for (const functionId of filteredIds) {
			try {
				const response = await handleRequest(
					'GET',
					`/api/query/v1/functions/template/${functionId}?hidden=true`
				);

				const originalLinks = response.links;
				const { valid: validLinks, invalid: invalidLinks } =
					await sanitizeLinks(originalLinks);

				// Check if any invalid links are visible
				const hasInvalidVisibleLink = invalidLinks.some(
					(link) => link.visible === true
				);

				// If function has only one link and it's invalid, OR has any invalid visible link, delete the function
				if (
					(originalLinks &&
						originalLinks.length === 1 &&
						invalidLinks.length === 1 &&
						validLinks.length === 0) ||
					hasInvalidVisibleLink
				) {
					const deleteUrl = `/api/query/v1/functions/template/${functionId}`;
					await handleRequest('DELETE', deleteUrl);

					if (response.global === false) {
						deletedBeastModes.push(functionId);
					} else {
						deletedVariables.push(functionId);
					}
					continue; // Skip adding to transfer list
				}

				// Update links individually if there are invalid links to remove
				if (invalidLinks.length > 0) {
					const linkUrl = `/api/query/v1/functions/template/${functionId}/links`;
					const linkBody = {
						linkTo: validLinks,
						unlinkFrom: invalidLinks
					};
					await handleRequest('POST', linkUrl, linkBody);
				}

				const functionData = {
					id: functionId,
					owner: newOwnerId,
					links: validLinks
				};

				if (response.global === false) {
					beastModes.push(functionData);
				} else {
					variables.push(functionData);
				}
			} catch (error) {
				console.error(`Failed to process function ${functionId}:`, error);
			}
		}

		// Transfer functions in batches
		const chunkSize = 100;
		for (let i = 0; i < beastModes.length; i += chunkSize) {
			const chunk = beastModes.slice(i, i + chunkSize);
			await handleRequest('POST', bulkUrl, { update: chunk });
		}
		for (let i = 0; i < variables.length; i += chunkSize) {
			const chunk = variables.slice(i, i + chunkSize);
			await handleRequest('POST', bulkUrl, { update: chunk });
		}

		// Log results
		if (beastModes.length > 0) {
			await logTransfers(
				userId,
				newOwnerId,
				'BEAST_MODE_FORMULA',
				beastModes.map((func) => func.id)
			);
		}
		if (variables.length > 0) {
			await logTransfers(
				userId,
				newOwnerId,
				'VARIABLE',
				variables.map((func) => func.id)
			);
		}
		if (deletedBeastModes.length > 0) {
			await logTransfers(
				userId,
				newOwnerId,
				'BEAST_MODE_FORMULA',
				deletedBeastModes,
				'DELETED',
				'Beast Mode was linked to deleted or inaccessible resources'
			);
		}
		if (deletedVariables.length > 0) {
			await logTransfers(
				userId,
				newOwnerId,
				'VARIABLE',
				deletedVariables,
				'DELETED',
				'Variable was linked to deleted or inaccessible resources'
			);
		}
	} else {
		// Use existing discovery logic
		let moreData = true;
		let offset = 0;
		const limit = 100;
		const chunkSize = 100; // Max objects per transfer request

		while (moreData) {
			const data = {
				filters: [{ field: 'owner', idList: [userId] }],
				sort: {
					field: 'name',
					ascending: true
				},
				limit: limit,
				offset: offset
			};

			const response = await handleRequest(
				'POST',
				'/api/query/v1/functions/search',
				data
			);

			const bulkUrl = '/api/query/v1/functions/bulk/template';
			if (response.results && response.results.length > 0) {
				// Process beast modes
				const beastModesRaw = response.results.filter(
					(func) => func.global === false
				);
				const beastModes = [];
				const deletedBeastModes = [];

				for (const beastMode of beastModesRaw) {
					const originalLinks = beastMode.links;
					const { valid: validLinks, invalid: invalidLinks } =
						await sanitizeLinks(originalLinks);

					// Check if any invalid links are visible
					const hasInvalidVisibleLink = invalidLinks.some(
						(link) => link.visible === true
					);

					// If function has only one link and it's invalid, OR has any invalid visible link, delete the function
					if (
						(originalLinks &&
							originalLinks.length === 1 &&
							invalidLinks.length === 1 &&
							validLinks.length === 0) ||
						hasInvalidVisibleLink
					) {
						const deleteUrl = `/api/query/v1/functions/template/${beastMode.id}`;
						await handleRequest('DELETE', deleteUrl);
						deletedBeastModes.push(beastMode.id);
						continue; // Skip adding to transfer list
					}

					// Update links individually if there are invalid links to remove
					if (invalidLinks.length > 0) {
						const linkUrl = `/api/query/v1/functions/template/${beastMode.id}/links`;
						const linkBody = {
							linkTo: validLinks,
							unlinkFrom: invalidLinks
						};
						await handleRequest('POST', linkUrl, linkBody);
					}

					beastModes.push({
						id: beastMode.id,
						owner: newOwnerId,
						links: validLinks
					});
				}

				// Transfer beast modes in batches of 100
				for (let i = 0; i < beastModes.length; i += chunkSize) {
					const chunk = beastModes.slice(i, i + chunkSize);
					await handleRequest('POST', bulkUrl, { update: chunk });
				}

				// Log transferred beast modes
				if (beastModes.length > 0) {
					await logTransfers(
						userId,
						newOwnerId,
						'BEAST_MODE_FORMULA',
						beastModes.map((func) => func.id)
					);
				}

				// Log deleted beast modes
				if (deletedBeastModes.length > 0) {
					await logTransfers(
						userId,
						newOwnerId,
						'BEAST_MODE_FORMULA',
						deletedBeastModes,
						'DELETED',
						'Beast Mode was linked to deleted or inaccessible resources'
					);
				}

				// Process variables
				const variablesRaw = response.results.filter(
					(func) => func.global === true
				);
				const variables = [];
				const deletedVariables = [];

				for (const variable of variablesRaw) {
					const originalLinks = variable.links;
					const { valid: validLinks, invalid: invalidLinks } =
						await sanitizeLinks(originalLinks);

					// Check if any invalid links are visible
					const hasInvalidVisibleLink = invalidLinks.some(
						(link) => link.visible === true
					);

					// If function has only one link and it's invalid, OR has any invalid visible link, delete the function
					if (
						(originalLinks &&
							originalLinks.length === 1 &&
							invalidLinks.length === 1 &&
							validLinks.length === 0) ||
						hasInvalidVisibleLink
					) {
						const deleteUrl = `/api/query/v1/functions/template/${variable.id}`;
						await handleRequest('DELETE', deleteUrl);
						deletedVariables.push(variable.id);
						continue; // Skip adding to transfer list
					}

					// Update links individually if there are invalid links to remove
					if (invalidLinks.length > 0) {
						const linkUrl = `/api/query/v1/functions/template/${variable.id}/links`;
						const linkBody = {
							linkTo: validLinks,
							unlinkFrom: invalidLinks
						};
						await handleRequest('POST', linkUrl, linkBody);
					}

					variables.push({
						id: variable.id,
						owner: newOwnerId,
						links: validLinks
					});
				}

				// Transfer variables in batches of 100
				for (let i = 0; i < variables.length; i += chunkSize) {
					const chunk = variables.slice(i, i + chunkSize);
					await handleRequest('POST', bulkUrl, { update: chunk });
				}

				// Log transferred variables
				if (variables.length > 0) {
					await logTransfers(
						userId,
						newOwnerId,
						'VARIABLE',
						variables.map((func) => func.id)
					);
				}

				// Log deleted variables
				if (deletedVariables.length > 0) {
					await logTransfers(
						userId,
						newOwnerId,
						'VARIABLE',
						deletedVariables,
						'DELETED',
						'Variable was linked to deleted or inaccessible resources'
					);
				}

				// Increment offset to get next page
				offset += limit;

				moreData = response.hasMore;
			} else {
				// No more data returned, stop loop
				moreData = false;
			}
		}
	}
}

//-----------------------------Accounts---------------------//

async function transferAccounts(userId, newOwnerId, filteredIds = []) {
	let accountIds = [];

	if (filteredIds.length > 0) {
		// Use the provided filtered list
		accountIds = filteredIds;
	} else {
		// Use existing discovery logic
		let moreData = true;
		let offset = 0;
		const count = 100;

		while (moreData) {
			const data = {
				count: count,
				offset: offset,
				combineResults: false,
				hideSearchObjects: true,
				query: '**',
				filters: [
					{
						filterType: 'term',
						field: 'owned_by_id',
						value: userId,
						name: 'Owned by',
						not: false
					}
				],
				facetValuesToInclude: [],
				queryProfile: 'GLOBAL',
				entityList: [['account']]
			};

			const response = await handleRequest(
				'POST',
				'/api/search/v1/query',
				data
			);
			if (
				response.searchResultsMap &&
				response.searchResultsMap.account.length > 0
			) {
				// Extract ids and append to list
				const ids = response.searchResultsMap.account.map(
					(account) => account.databaseId
				);
				accountIds.push(...ids);

				// Increment offset to get next page
				offset += count;

				// If less than pageSize returned, this is the last page
				if (response.searchResultsMap.account.length < count) {
					moreData = false;
				}
			} else {
				// No more data returned, stop loop
				moreData = false;
			}
		}
	}

	if (accountIds.length > 0) {
		for (let i = 0; i < accountIds.length; i++) {
			const transferUrl = `/api/data/v2/accounts/share/${accountIds[i]}`;
			const addBody = { type: 'USER', id: newOwnerId, accessLevel: 'OWNER' };
			await handleRequest('PUT', transferUrl, addBody);

			// Removed because their access will be removed when they are deleted
			// const removeBody = { type: 'USER', id: userId, accessLevel: 'NONE' };
			// await handleRequest('PUT', transferUrl, removeBody);
		}

		await logTransfers(userId, newOwnerId, 'ACCOUNT', accountIds);
	}
}

//---------------------------Jupyter Workspaces---------------------//

async function transferJupyterWorkspaces(userId, newOwnerId, filteredIds = []) {
	let jupyterWorkspaceIds = [];

	if (filteredIds.length > 0) {
		// Use the provided filtered list
		jupyterWorkspaceIds = filteredIds;
	} else {
		// Use existing discovery logic
		let moreData = true;
		let offset = 0;
		const limit = 100;

		while (moreData) {
			const data = {
				sortFieldMap: {
					LAST_RUN: 'DESC'
				},
				searchFieldMap: {},
				filters: [
					{
						type: 'OWNER',
						values: [userId]
					}
				],
				offset: offset,
				limit: limit
			};

			const response = await handleRequest(
				'POST',
				'/api/datascience/v1/search/workspaces',
				data
			);

			if (response.workspaces && response.workspaces.length > 0) {
				// Extract ids and append to list
				const ids = response.workspaces.map((workspace) => workspace.id);
				jupyterWorkspaceIds.push(...ids);

				// Increment offset to get next page
				offset += limit;

				// If less than pageSize returned, this is the last page
				if (response.workspaces.length < limit) {
					moreData = false;
				}
			} else {
				// No more data returned, stop loop
				moreData = false;
			}
		}
	}

	if (jupyterWorkspaceIds.length > 0) {
		for (let i = 0; i < jupyterWorkspaceIds.length; i++) {
			const url = `/api/datascience/v1/workspaces/${jupyterWorkspaceIds[i]}/ownership`;
			await handleRequest('PUT', url, { newOwnerId });
		}
		await logTransfers(
			userId,
			newOwnerId,
			'DATA_SCIENCE_NOTEBOOK',
			jupyterWorkspaceIds
		);
	}
}

//------------------------------Code Engine Packages--------------------------//

async function transferCodeEnginePackages(
	userId,
	newOwnerId,
	filteredIds = []
) {
	let codeEnginePackageIds = [];

	if (filteredIds.length > 0) {
		// Use the provided filtered list
		codeEnginePackageIds = filteredIds;
	} else {
		// Use existing discovery logic
		let moreData = true;
		let offset = 0;
		const count = 100;

		while (moreData) {
			const data = {
				query: '**',
				entityList: [['package']],
				count: count,
				offset: offset,
				filters: [
					{
						field: 'owned_by_id',
						filterType: 'term',
						value: `${userId}:USER`
					}
				],
				hideSearchObjects: true,
				facetValuesToInclude: []
			};

			const response = await handleRequest(
				'POST',
				'/api/search/v1/query',
				data
			);

			if (
				response.searchResultsMap.package &&
				response.searchResultsMap.package.length > 0
			) {
				// Extract ids and append to list
				const ids = response.searchResultsMap.package.map(
					(codeEngine) => codeEngine.uuid
				);
				codeEnginePackageIds.push(...ids);

				// Increment offset to get next page
				offset += count;

				// If less than pageSize returned, this is the last page
				if (response.searchResultsMap.package.length < count) {
					moreData = false;
				}
			} else {
				// No more data returned, stop loop
				moreData = false;
			}
		}
	}

	if (codeEnginePackageIds.length > 0) {
		for (let i = 0; i < codeEnginePackageIds.length; i++) {
			const url = `/api/codeengine/v2/packages/${codeEnginePackageIds[i]}`;
			await handleRequest('PUT', url, { owner: parseInt(newOwnerId) });
		}
		await logTransfers(
			userId,
			newOwnerId,
			'CODEENGINE_PACKAGE',
			codeEnginePackageIds
		);
	}
}

//---------------------------------------FileSets--------------------------------------------//

async function transferFilesets(userId, newOwnerId, filteredIds = []) {
	let filesetIds = [];

	if (filteredIds.length > 0) {
		// Use the provided filtered list
		filesetIds = filteredIds;
	} else {
		// Use existing discovery logic
		let moreData = true;
		let offset = 0;
		const limit = 100;

		const data = {
			filters: [
				{
					field: 'owner',
					value: [userId],
					not: false,
					operator: 'EQUALS'
				}
			],
			fieldSort: [
				{
					field: 'updated',
					order: 'DESC'
				}
			],
			dateFilters: []
		};

		while (moreData) {
			const url = `/api/files/v1/filesets/search?offset=${offset}&limit=${limit}`;
			const response = await handleRequest('POST', url, data);

			if (response.filesets && response.filesets.length > 0) {
				// Extract ids and append to list
				const ids = response.filesets.map((fileset) => fileset.id);
				filesetIds.push(...ids);

				// Increment offset to get next page
				offset += limit;

				// If less than pageSize returned, this is the last page
				if (response.filesets.length < limit) {
					moreData = false;
				}
			} else {
				// No more data returned, stop loop
				moreData = false;
			}
		}
	}

	if (filesetIds.length > 0) {
		for (let i = 0; i < filesetIds.length; i++) {
			const url = `/api/files/v1/filesets/${filesetIds[i]}/ownership`;
			await handleRequest('POST', url, { userId: parseInt(newOwnerId) });
		}
		await logTransfers(userId, newOwnerId, 'FILESET', filesetIds);
	}
}

//--------------------------------------Domo Everywhere Publications------------------------------------------//

// Limitation the new owner must be an owner of all the content
// Just get a list of publications for the manager to review

async function getPublications(userId, newOwnerId) {
	let publications = [];
	const url = '/api/publish/v2/publications';

	const response = await handleRequest('GET', url);
	if (response && response.length > 0) {
		for (let i = 0; i < response.length; i++) {
			const publicationId = response[i].id;
			const publicationUrl = `/api/publish/v2/publications/${publicationId}`;
			const response2 = await handleRequest('GET', publicationUrl);
			if (response2.content.userId == userId) {
				publications.push(publicationId);
			}
		}
	}

	await logTransfers(
		userId,
		newOwnerId,
		'PUBLICATION',
		publications,
		'NOT_TRANSFERRED',
		'Publications cannot be transferred as the new owner must be an owner of all the content'
	);
}

//-------------------------------------Domo Everywhere Subscriptions-----------------------------------------//

async function transferSubscriptions(userId, newOwnerId, filteredIds = []) {
	let subscriptionIds = [];

	if (filteredIds.length > 0) {
		// Use the provided filtered list
		for (const subscriptionId of filteredIds) {
			try {
				const subscriptionUrl = `api/publish/v2/subscriptions/${subscriptionId}/share`;
				const subscription = await handleRequest('GET', subscriptionUrl);

				if (subscription.userId == userId) {
					const url = `/api/publish/v2/subscriptions/${subscription.subscription.id}`;
					const body = {
						publicationId: subscription.subscription.publicationId,
						domain: subscription.subscription.domain,
						customerId: subscription.subscription.customerId,
						userId: newOwnerId,
						userIds: subscription.shareUsers,
						groupIds: subscription.shareGroups
					};
					await handleRequest('PUT', url, body);
					subscriptionIds.push(subscription.subscription.id);
				}
			} catch (error) {
				console.error(
					`Failed to transfer subscription ${subscriptionId}:`,
					error
				);
			}
		}
	} else {
		// Use existing discovery logic
		const limit = 40;
		let offset = 0;
		let moreData = true;
		let subscriptions = [];

		while (moreData) {
			const url = 'api/publish/v2/subscriptions/summaries';
			const response = await handleRequest('GET', url);

			if (response && response.length > 0) {
				subscriptions.push(...response);

				// Increment offset to get next page
				offset += limit;

				// If less than limit returned, this is the last page
				if (response.length < limit) {
					moreData = false;
				}
			} else {
				moreData = false;
			}
		}

		for (let i = 0; i < subscriptions.length; i++) {
			const subscriptionUrl = `api/publish/v2/subscriptions/${subscriptions[i].subscriptionId}/share`;
			const subscription = await handleRequest('GET', subscriptionUrl);

			if (subscription.userId == userId) {
				subscriptionIds.push(subscription.subscription.id);
				const url = `/api/publish/v2/subscriptions/${subscription.subscription.id}`;
				const body = {
					publicationId: subscription.subscription.publicationId,
					domain: subscription.subscription.domain,
					customerId: subscription.subscription.customerId,
					userId: newOwnerId,
					userIds: subscription.shareUsers,
					groupIds: subscription.shareGroups
				};
				await handleRequest('PUT', url, body);
			}
		}
	}

	if (subscriptionIds.length > 0) {
		await logTransfers(userId, newOwnerId, 'SUBSCRIPTION', subscriptionIds);
	}
}

//--------------------------------------------------Sandbox Repositories---------------------------------//

async function transferRepositories(userId, newOwnerId, filteredIds = []) {
	let repositoryIds = [];

	if (filteredIds.length > 0) {
		// Use the provided filtered list
		repositoryIds = filteredIds;
	} else {
		// Use existing discovery logic
		const limit = 50;
		let offset = 0;
		let moreData = true;

		while (moreData) {
			const data = {
				query: {
					offset: offset,
					limit: limit,
					fieldSearchMap: {},
					sort: 'lastCommit',
					order: 'desc',
					filters: { userId: [userId] },
					dateFilters: {}
				}
			};

			const response = await handleRequest(
				'POST',
				'/api/version/v1/repositories/search',
				data
			);

			if (response.repositories && response.repositories.length > 0) {
				// Extract ids and append to list
				const ids = response.repositories.map((repository) => repository.id);
				repositoryIds.push(...ids);

				// Increment offset to get next page
				offset += limit;

				// If less than pageSize returned, this is the last page
				if (response.repositories.length < limit) {
					moreData = false;
				}
			} else {
				// No more data returned, stop loop
				moreData = false;
			}
		}
	}

	if (repositoryIds.length > 0) {
		for (let i = 0; i < repositoryIds.length; i++) {
			const url = `/api/version/v1/repositories/${repositoryIds[i]}/permissions`;

			const body = {
				repositoryPermissionUpdates: [
					{
						userId: newOwnerId,
						permission: 'OWNER'
					},
					{
						userId: userId,
						permission: 'NONE'
					}
				]
			};

			await handleRequest('POST', url, body);
		}
		await logTransfers(userId, newOwnerId, 'REPOSITORY', repositoryIds);
	}
}

//-----------------------------------------Approvals--------------------------------------//

async function transferApprovals(userId, newOwnerId) {
	// Use existing discovery logic
	const url = '/api/synapse/approval/graphql';

	const data = {
		operationName: 'getFilteredRequests',
		variables: {
			query: {
				active: true,
				submitterId: null,
				approverId: userId,
				templateId: null,
				title: null,
				lastModifiedBefore: null
			},
			after: null,
			reverseSort: false
		},
		query:
			'query getFilteredRequests($query: QueryRequest!, $after: ID, $reverseSort: Boolean) {\n  workflowSearch(query: $query, type: "AC", after: $after, reverseSort: $reverseSort) {\n    edges {\n      cursor\n      node {\n        approval {\n          id\n          title\n          templateTitle\n          status\n          modifiedTime\n          version\n          providerName\n          approvalChainIdx\n          pendingApprover: pendingApproverEx {\n            id\n            type\n            displayName\n            ... on User {\n              title\n              avatarKey\n              __typename\n            }\n            ... on Group {\n              isDeleted\n              __typename\n            }\n            __typename\n          }\n          submitter {\n            id\n            type\n            displayName\n            avatarKey\n            isCurrentUser\n            __typename\n          }\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    pageInfo {\n      hasNextPage\n      hasPreviousPage\n      startCursor\n      endCursor\n      __typename\n    }\n    __typename\n  }\n}\n'
	};

	const response = await handleRequest('POST', url, data);
	const responseApprovals = response.data.workflowSearch.edges;

	const pendingApprovals = responseApprovals.filter(
		(approval) => approval.node.approval.status === 'PENDING'
	);

	const sentBackApprovals = responseApprovals.filter(
		(approval) => approval.node.approval.status === 'SENTBACK'
	);

	for (let i = 0; i < pendingApprovals.length; i++) {
		if (pendingApprovals[i].node.approval.status == 'PENDING') {
			const approvalId = pendingApprovals[i].node.approval.id;
			const version = pendingApprovals[i].node.approval.version;

			const transferBody = {
				operationName: 'replaceApprovers',
				variables: {
					actedOnApprovals: [
						{
							id: approvalId,
							version: version
						}
					],
					newApproverId: newOwnerId,
					newApproverType: 'PERSON'
				},
				query:
					'mutation replaceApprovers($actedOnApprovals: [ActedOnApprovalInput!]!, $newApproverId: ID!, $newApproverType: ApproverType) {\n  bulkReplaceApprover(actedOnApprovals: $actedOnApprovals, newApproverId: $newApproverId, newApproverType: $newApproverType) {\n    id\n    __typename\n  }\n}\n'
			};

			await handleRequest('POST', url, transferBody);
		}
	}

	if (pendingApprovals.length > 0) {
		await logTransfers(
			userId,
			newOwnerId,
			'APPROVAL',
			pendingApprovals.map((approval) => approval.node.approval.id)
		);
	}

	if (sentBackApprovals.length > 0) {
		await logTransfers(
			userId,
			newOwnerId,
			'APPROVAL',
			sentBackApprovals.map((approval) => approval.node.approval.id),
			'NOT_TRANSFERRED',
			'Transferring of sent back approvals is not supported'
		);
	}
}

//-----------------------------------------Approval Templates--------------------------------------//

async function transferApprovalTemplates(userId, newOwnerId) {
	// Use existing discovery logic
	const url = '/api/synapse/approval/graphql';

	const searchTemplatesBody = {
		operationName: 'getFilteredTemplates',
		variables: {
			first: 100,
			after: null,
			orderBy: 'TEMPLATE',
			reverseSort: false,
			query: {
				type: 'AC',
				searchTerm: '',
				category: [],
				ownerId: userId,
				publishedOnly: false
			}
		},
		query: `query getFilteredTemplates(
		  $first: Int
		  $after: ID
		  $orderBy: OrderBy
		  $reverseSort: Boolean
		  $query: TemplateQueryRequest!
		) {
		  templateConnection(
		    first: $first
		    after: $after
		    orderBy: $orderBy
		    reverseSort: $reverseSort
		    query: $query
		  ) {
		    edges {
		      cursor
		      node {
		        id
		      }
		    }
		    pageInfo {
		      hasNextPage
		      hasPreviousPage
		      startCursor
		      endCursor
		    }
		  }
		}`
	};

	const searchTemplatesResponse = await handleRequest(
		'POST',
		url,
		searchTemplatesBody
	);

	if (searchTemplatesResponse.data.templateConnection.edges.length > 0) {
		const approvalTemplateIds =
			searchTemplatesResponse.data.templateConnection.edges.map(
				(edge) => edge.node.id
			);

		let getTemplateBody = {
			operationName: 'getTemplateForEdit',
			variables: {
				id: null
			},
			query:
				'query getTemplateForEdit($id: ID!) {\n  template(id: $id) {\n    id\n    title\n    titleName\n    titlePlaceholder\n    acknowledgment\n    instructions\n    description\n    providerName\n    isPublic\n    chainIsLocked\n    type\n    isPublished\n    observers {\n      id\n      type\n      displayName\n      avatarKey\n      title\n      ... on Group {\n        userCount\n        isDeleted\n        __typename\n      }\n      ... on User {\n        isDeleted\n        __typename\n      }      __typename\n    }\n    categories {\n      id\n      name\n      __typename\n    }\n    owner {\n      id\n      displayName\n      avatarKey\n      __typename\n    }\n    fields {\n      key\n      type\n      name\n      data\n      placeholder\n      required\n      isPrivate\n      ... on SelectField {\n        option\n        multiselect\n        datasource\n        column\n        order\n        __typename\n      }\n      __typename\n    }\n    approvers {\n      type\n      originalType: type\n      key\n      ... on ApproverPerson {\n        id: approverId\n        approverId\n        userDetails {\n          id\n          displayName\n          title\n          avatarKey\n          isDeleted\n          __typename\n        }\n        __typename\n      }\n      ... on ApproverGroup {\n        id: approverId\n        approverId\n        groupDetails {\n          id\n          displayName\n          userCount\n          isDeleted\n          __typename\n        }\n        __typename\n      }\n      ... on ApproverPlaceholder {\n        placeholderText\n        __typename\n      }\n      __typename\n    }\n    workflowIntegration {\n      modelId\n      modelVersion\n      startName\n      modelName\n      parameterMapping {\n        fields {\n          field\n          parameter\n          required\n          type\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n  categories {\n    id\n    name\n    __typename\n  }\n}'
		};

		// For each template—get full details, update owner, approvers, and observers—then save
		for (let i = 0; i < approvalTemplateIds.length; i++) {
			getTemplateBody.variables.id = approvalTemplateIds[i];
			const getTemplateResponse = await handleRequest(
				'POST',
				url,
				getTemplateBody
			);
			const rawTemplate = getTemplateResponse.data.template;

			// Remove approvers that are no longer active (isDeleted is nested differently per type)
			const activeApprovers = (rawTemplate.approvers || []).filter(
				(approver) =>
					!(approver.type === 'PERSON' && approver.userDetails.isDeleted) &&
					!(approver.type === 'GROUP' && approver.groupDetails.isDeleted)
			);

			// Update approvers: if user is an approver, replace with new owner
			let approvers = activeApprovers.map((approver) =>
				approver.type === 'PERSON' && approver.approverId == userId
					? { approverId: newOwnerId, type: 'PERSON', key: approver.key }
					: {
							type: approver.type,
							key: approver.key,
							...(approver.approverId && { approverId: approver.approverId }),
							...(approver.placeholderText && {
								placeholderText: approver.placeholderText
							})
						}
			);

			// Remove duplicate approvers based on approverId, in case the new owner was already an approver
			approvers = approvers.filter(
				(value, index, self) =>
					!value.approverId ||
					index === self.findIndex((a) => a.approverId === value.approverId)
			);

			// Approvers cannot be empty—if all were removed, add the new owner as the approver
			if (approvers.length === 0) {
				approvers.push({ approverId: newOwnerId, type: 'PERSON', key: '0' });
			}

			// Update observers: if user is an observer, replace with new owner
			// User observers only need id and type; Group observers also need userCount
			let observers = (rawTemplate.observers || []).map((observer) => ({
				id: observer.id == userId ? newOwnerId : observer.id,
				type: observer.type,
				...(observer.type === 'Group' &&
					observer.userCount !== undefined && { userCount: observer.userCount })
			}));

			// Remove duplicate observers based on id, in case the new owner was already an observer
			observers = observers.filter(
				(value, index, self) =>
					index === self.findIndex((o) => o.id === value.id)
			);

			// Remove observers that are no longer active (check against raw data before we stripped fields)
			const deletedObserverIds = new Set(
				(rawTemplate.observers || [])
					.filter((o) => o.isDeleted)
					.map((o) => o.id)
			);
			observers = observers.filter((o) => !deletedObserverIds.has(o.id));

			// Build a clean template input with only the fields TemplateInput expects
			// (strip __typename, resolved nested objects like owner/userDetails/groupDetails, etc.)
			const cleanTemplate = {
				id: rawTemplate.id,
				title: rawTemplate.title,
				titleName: rawTemplate.titleName,
				titlePlaceholder: rawTemplate.titlePlaceholder,
				acknowledgment: rawTemplate.acknowledgment,
				instructions: rawTemplate.instructions,
				description: rawTemplate.description,
				providerName: rawTemplate.providerName,
				isPublic: rawTemplate.isPublic,
				chainIsLocked: rawTemplate.chainIsLocked,
				type: rawTemplate.type,
				isPublished: rawTemplate.isPublished,
				ownerId: newOwnerId,
				fields: (rawTemplate.fields || []).map((field) => ({
					key: field.key,
					type: field.type,
					name: field.name,
					placeholder: field.placeholder,
					required: field.required,
					isPrivate: field.isPrivate,
					...(field.data !== undefined && { data: field.data }),
					// Include SelectField-specific properties if present
					...(field.option !== undefined && { option: field.option }),
					...(field.multiselect !== undefined && {
						multiselect: field.multiselect
					}),
					...(field.datasource !== undefined && {
						datasource: field.datasource
					}),
					...(field.column !== undefined && { column: field.column }),
					...(field.order !== undefined && { order: field.order })
				})),
				approvers: approvers,
				observers: observers,
				categories: (rawTemplate.categories || []).map((c) => ({
					id: c.id,
					name: c.name
				}))
			};

			// Include workflowIntegration if present
			if (rawTemplate.workflowIntegration) {
				cleanTemplate.workflowIntegration = {
					modelId: rawTemplate.workflowIntegration.modelId,
					modelVersion: rawTemplate.workflowIntegration.modelVersion,
					startName: rawTemplate.workflowIntegration.startName,
					modelName: rawTemplate.workflowIntegration.modelName
				};
				if (rawTemplate.workflowIntegration.parameterMapping) {
					cleanTemplate.workflowIntegration.parameterMapping = {
						fields: (
							rawTemplate.workflowIntegration.parameterMapping.fields || []
						).map((f) => ({
							field: f.field,
							parameter: f.parameter,
							required: f.required,
							type: f.type
						}))
					};
				}
			}

			const transferTemplateBody = {
				operationName: 'saveTemplate',
				variables: {
					template: cleanTemplate
				},
				query: `mutation saveTemplate($template: TemplateInput!) {\n  template: saveTemplate(template: $template) {\n    id\n    title\n    titleName\n    titlePlaceholder\n    acknowledgment\n    instructions\n    description\n    providerName\n    isPublic\n    chainIsLocked\n    owner {\n      id\n      displayName\n      avatarKey\n      __typename\n    }\n    fields {\n      key\n      type\n      name\n      placeholder\n      required\n      isLocked\n      __typename\n    }\n    approvers {\n      type\n      originalType: type\n      key\n      ... on ApproverPerson {\n        approverId\n        userDetails {\n          id\n          displayName\n          title\n          avatarKey\n          __typename\n        }\n        __typename\n      }\n      ... on ApproverGroup {\n        approverId\n        groupDetails {\n          id\n          displayName\n          userCount\n          isDeleted\n          __typename\n        }\n        __typename\n      }\n      ... on ApproverPlaceholder {\n        placeholderText\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}`
			};

			await handleRequest('POST', url, transferTemplateBody);
		}
		await logTransfers(userId, newOwnerId, 'TEMPLATE', approvalTemplateIds);
	}
}

//--------------------------------Custom Apps (Bricks and Pro Code Apps)-------------------------------------//

async function transferCustomApps(userId, newOwnerId, filteredIds = []) {
	let allAppIds = [];
	let bricks = [];
	let proCodeApps = [];

	if (filteredIds.length > 0) {
		// Use the provided filtered list
		allAppIds = filteredIds;

		// We need to check each app to categorize it properly
		for (const appId of filteredIds) {
			const response = await handleRequest(
				'GET',
				`/api/apps/v1/designs/${appId}?parts=versions`
			);

			if (response && response.owner == userId) {
				if (
					response.versions &&
					response.versions.length > 0 &&
					Object.hasOwn(Object(response.versions[0]), 'flags')
				) {
					if (
						Object.hasOwn(
							Object(response.versions[0].flags),
							'client-code-enabled'
						)
					) {
						if (response.versions[0].flags['client-code-enabled']) {
							bricks.push(appId);
						} else {
							proCodeApps.push(appId);
						}
					} else {
						proCodeApps.push(appId);
					}
				} else {
					proCodeApps.push(appId);
				}

				const transferUrl = `/api/apps/v1/designs/${appId}/permissions/ADMIN`;
				const body = [newOwnerId];
				await handleRequest('POST', transferUrl, body);
			}
		}
	} else {
		// Use existing discovery logic
		const limit = 100;
		let offset = 0;
		let moreData = true;

		while (moreData) {
			const url = `/api/apps/v1/designs?checkAdminAuthority=true&deleted=false&limit=${limit}&offset=${offset}`;
			const response = await handleRequest('GET', url);

			if (response && response.length > 0) {
				for (let i = 0; i < response.length; i++) {
					if (response[i].owner == userId) {
						if (
							response[i].versions &&
							response[i].versions.length > 0 &&
							Object.hasOwn(Object(response[i].versions[0]), 'flags')
						) {
							if (
								Object.hasOwn(
									Object(response[i].versions[0].flags),
									'client-code-enabled'
								)
							) {
								if (response[i].versions[0].flags['client-code-enabled']) {
									bricks.push(response[i].id);
								} else {
									proCodeApps.push(response[i].id);
								}
							} else {
								proCodeApps.push(response[i].id);
							}
						} else {
							proCodeApps.push(response[i].id);
						}
						const transferUrl = `/api/apps/v1/designs/${response[i].id}/permissions/ADMIN`;
						const body = [newOwnerId];
						await handleRequest('POST', transferUrl, body);
					}
				}

				if (response.length < limit) {
					moreData = false;
				}

				offset += limit;
			} else {
				// No more data returned, stop loop
				moreData = false;
			}
		}
	}

	if (bricks.length > 0) {
		await logTransfers(userId, newOwnerId, 'APP', bricks);
	}
	if (proCodeApps.length > 0) {
		await logTransfers(userId, newOwnerId, 'RYUU_APP', proCodeApps);
	}
}

//-------------------------------------AI Models--------------------------------//

async function transferAiModels(userId, newOwnerId, filteredIds = []) {
	let models = [];

	if (filteredIds.length > 0) {
		// Use the provided filtered list
		models = filteredIds;
	} else {
		// Use existing discovery logic
		const limit = 50;
		let offset = 0;
		let moreData = true;

		while (moreData) {
			const data = {
				limit: 50,
				offset: 0,
				sortFieldMap: {
					CREATED: 'DESC'
				},
				searchFieldMap: { NAME: '' },
				filters: [{ type: 'OWNER', values: [userId] }],
				metricFilters: {},
				dateFilters: {},
				sortMetricMap: {}
			};

			const response = await handleRequest(
				'POST',
				'/api/datascience/ml/v1/search/models',
				data
			);

			if (response && response.models.length > 0) {
				// Extract ids and append to list
				const ids = response.models.map((model) => model.id);
				models.push(...ids);

				if (response.models.length < limit) {
					moreData = false;
				}

				offset += limit;
			} else {
				// No more data returned, stop loop
				moreData = false;
			}
		}
	}

	if (models.length > 0) {
		for (let i = 0; i < models.length; i++) {
			const url = `/api/datascience/ml/v1/models/${models[i]}/ownership`;
			const data = { userId: newOwnerId };
			await handleRequest('POST', url, data);
		}
		await logTransfers(userId, newOwnerId, 'AI_MODEL', models); // Not recorded in the activity log
	}
}

//-----------------------------------AI Projects----------------------------------//

async function transferAiProjects(userId, newOwnerId, filteredIds = []) {
	let projects = [];

	if (filteredIds.length > 0) {
		// Use the provided filtered list
		projects = filteredIds;
	} else {
		// Use existing discovery logic
		const limit = 50;
		let offset = 0;
		let moreData = true;

		while (moreData) {
			const data = {
				limit: 50,
				offset: 0,
				sortFieldMap: {
					CREATED: 'DESC'
				},
				searchFieldMap: { NAME: '' },
				filters: [{ type: 'OWNER', values: [userId] }],
				metricFilters: {},
				dateFilters: {},
				sortMetricMap: {}
			};

			const response = await handleRequest(
				'POST',
				'/api/datascience/ml/v1/search/projects',
				data
			);

			if (response && response.projects.length > 0) {
				// Extract ids and append to list
				const ids = response.projects.map((model) => model.id);
				projects.push(...ids);

				if (response.projects.length < limit) {
					moreData = false;
				}

				offset += limit;
			} else {
				// No more data returned, stop loop
				moreData = false;
			}
		}
	}

	if (projects.length > 0) {
		for (let i = 0; i < projects.length; i++) {
			const url = `/api/datascience/ml/v1/projects/${projects[i]}/ownership`;
			const data = { userId: newOwnerId };
			await handleRequest('POST', url, data);
		}
		await logTransfers(userId, newOwnerId, 'AI_PROJECT', projects); // Not recorded in the activity log
	}
}

//--------------------------ProjectsAndTasks--------------------------//

async function transferProjectsAndTasks(userId, newOwnerId, filteredIds = []) {
	let allIds = [];
	let projects = [];
	let tasks = [];

	if (filteredIds.length > 0) {
		// Use the provided filtered list - combine PROJECT and PROJECT_TASK types
		allIds = filteredIds;
		// We'll need to fetch project details for each ID to process them properly
		for (const id of filteredIds) {
			try {
				// Try to get as project first
				const project = await handleRequest(
					'GET',
					`/api/content/v1/projects/${id}`
				);
				if (project && project.assignedTo == userId) {
					projects.push(project);
				}
			} catch (error) {
				// If not a project, might be a task
				try {
					const task = await handleRequest(
						'GET',
						`/api/content/v1/tasks/${id}`
					);
					if (task) {
						tasks.push(task);
					}
				} catch (taskError) {
					console.error(`Failed to process ID ${id}:`, taskError);
				}
			}
		}
	} else {
		// Use existing discovery logic
		let offset = 0;
		const limit = 100;
		let moreData = true;

		while (moreData) {
			const response = await handleRequest(
				'GET',
				`/api/content/v2/users/${userId}/projects?limit=${limit}&offset=${offset}`
			);

			if (response && response.length > 0) {
				// Extract ids and append to list
				projects.push(...response.projects);

				// Increment offset to get next page
				offset += limit;

				// If less than pageSize returned, this is the last page
				if (response.length < limit) {
					moreData = false;
				}
			} else {
				// No more data returned, stop loop
				moreData = false;
			}
		}

		// Get tasks for each project
		for (let i = 0; i < projects.length; i++) {
			const taskResponse = await handleRequest(
				'GET',
				`/api/content/v1/projects/${projects[i].id}/tasks?assignedToOwnerId=${userId}`
			);

			if (taskResponse && taskResponse.length > 0) {
				tasks.push(...taskResponse);
			}
		}
	}

	// Process tasks
	let taskIds = [];
	for (const task of tasks) {
		taskIds.push(task.id);
		if (task.primaryTaskOwner == userId) {
			task.primaryTaskOwner = newOwnerId;
		}
		task.contributors.push({
			assignedTo: newOwnerId,
			assignedBy: userId
		});
		task.owners.push({
			assignedTo: newOwnerId,
			assignedBy: userId
		});
		await handleRequest('PUT', `/api/content/v1/tasks/${task.id}`, task);
	}

	// Process projects
	let projectIds = [];
	for (const project of projects) {
		if (project.assignedTo == userId) {
			projectIds.push(project.id);
			const url = `/api/content/v1/projects/${project.id}`;
			const body = { id: project.id, creator: newOwnerId };
			await handleRequest('PUT', url, body);
		}
	}

	if (taskIds.length > 0) {
		await logTransfers(userId, newOwnerId, 'PROJECT_TASK', taskIds);
	}
	if (projectIds.length > 0) {
		await logTransfers(userId, newOwnerId, 'PROJECT', projectIds);
	}
}

async function transferMetrics(userId, newOwnerId, filteredIds = []) {
	let metrics = [];

	if (filteredIds.length > 0) {
		// Use the provided filtered list
		for (const metricId of filteredIds) {
			try {
				await handleRequest(
					'POST',
					`/api/content/v1/metrics/${metricId}/owner/${newOwnerId}`
				);
				metrics.push(metricId);
			} catch (error) {
				console.error(`Failed to transfer metric ${metricId}:`, error);
			}
		}
	} else {
		// Use existing discovery logic
		let moreData = true;
		let offset = 0;
		const limit = 100;

		while (moreData) {
			const data = {
				nameContains: 'string',
				filters: {
					OWNER: [userId]
				},
				orderBy: 'CREATED',
				followed: false,
				descendingOrderBy: false,
				limit: limit,
				offset: offset
			};

			const response = await handleRequest(
				'POST',
				'/api/content/v1/metrics/filter',
				data
			);

			if (response && response.metrics.length > 0) {
				// Process metrics
				for (const metric of response.metrics) {
					await handleRequest(
						'POST',
						`/api/content/v1/metrics/${metric.id}/owner/${newOwnerId}`
					);
					metrics.push(metric.id);
				}

				offset += limit;
			} else {
				moreData = false;
			}
		}
	}

	if (metrics.length > 0) {
		await logTransfers(userId, newOwnerId, 'METRIC', metrics);
	}
}
