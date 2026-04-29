/* eslint require-atomic-updates: 0 */

const codeengine = require('codeengine');

/**
 * @typedef {object} User
 * @property {number} id
 * @property {text} displayName
 * @property {text} userName
 * @property {text} emailAddress
 * @property {number} modified
 * @property {number} created
 * @property {number} roleId
 * @property {boolean} isSystemUser
 * @property {boolean} isActive
 */

class Helpers {
	/**
	 * @private
	 * @summary Handle Request
	 * @description Helper function to handle API requests and errors
	 * @param {text} method - The HTTP method
	 * @param {text} url - The endpoint URL
	 * @param {object} [body=null] - The request body
	 * @param {object} [headers=null] - The request headers
	 * @param {text} [contentType='application/json'] - Request body content type
	 * @returns {object} The response data
	 * @throws {error} If the request fails
	 */
	static async handleRequest(method, url, body = null, headers = null, contentType = 'application/json') {
		try {
			return await codeengine.sendRequest(method, url, body, headers, contentType);
		} catch (error) {
			console.error(
				`Error with ${method} request to ${url}\nPayload:\n${JSON.stringify(body, null, 2)}\nError:\n`,
				error
			);
			throw error;
		}
	}
}

const { handleRequest } = Helpers;

/**
 * @summary Generate UUID
 * @description Generates a Universally Unique Identifier (UUID)
 * @returns {text} uuid
 */
function generateUUID() {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
		var r = (Math.random() * 16) | 0,
			v = c == 'x' ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

/**
 * @summary Get List of Numbers Length
 * @description Determine the length of the provided list
 * @param {number[]} list - The list to get the length of
 * @returns {number} The length of the list
 */
function getListOfNumbersLength(list) {
	return list.length;
}

/**
 * @summary Get Number from List
 * @description Retrieve the number at the specified index in a list
 * @param {number[]} list - The list of numbers to source from
 * @param {number} index - The index of the number to get
 * @returns {number} The number at the specified index
 */
function getNumberFromList(list, index) {
	return list[index];
}

/**
 * @summary Cast Epoch Timestamp Number as Datetime
 * @description Takes an Epoch timestamp as a number and converts it to datetime
 * @param {number} epoch - The Epoch timestamp to cast, sent as a number
 * @returns {datetime} datetime - The resulting datetime after conversion
 */
function castEpochTimestampNumberAsDatetime(epoch) {
	return new Date(epoch);
}

/**
 * @summary Share DataSet with Person
 * @description Shares a dataset with a person
 * @param {dataset} dataset - The dataset
 * @param {person} person - The person to share the dataset with
 * @param {text} [permission='CAN_SHARE'] - The permission level to share the dataset with
 * @param {text} [message='I thought you might find this dataset interesting.'] - The message to include in the share email
 * @param {boolean} [sendEmail=false] - Whether to send an email notification to the person
 */
async function shareDatasetWithPerson(
	dataset,
	person,
	permission = 'CAN_SHARE',
	message = 'I thought you might find this dataset interesting.',
	sendEmail = false
) {
	const body = {
		permissions: {
			accessLevel: permission,
			id: person,
			type: 'USER'
		},
		message,
		sendEmail
	};
	await handleRequest('POST', `/api/data/v3/datasources/${dataset}/share`, body);
}

/**
 * @summary Delete Page and Cards
 * @description Deletes all cards on a given page then deletes the page
 * @param {text} pageId - integer id of page to delete
 * @returns {boolean} result - true if successful
 */
async function deletePageAndCards(pageId) {
	const page = await handleRequest('GET', `/api/content/v3/stacks/${pageId}/cards`);

	const cardIds = page.cards.map((card) => card.id).join(',');

	await handleRequest('DELETE', `/api/content/v1/cards/bulk?cardIds=${cardIds}`);

	await handleRequest('DELETE', `/api/content/v1/pages/${pageId}`);

	return true;
}

/**
 * @summary Delete Access Token
 * @description Deletes/revokes an API access token by ID
 * @param {number} accessTokenId - ID of the access token
 */
async function deleteAccessToken(accessTokenId) {
	await handleRequest('DELETE', `api/data/v1/accesstokens/${accessTokenId}`);
}

/**
 * @summary Bulk Update Users
 * @description Updates users in bulk
 * @param {object[]} users
 * @param {text} users[].id
 * @param {text} [users[].displayName]
 * @param {text} [users[].title]
 * @param {text} [users[].department]
 * @param {text} [users[].employeeId]
 * @param {text} [users[].employeeNumber]
 * @param {number} [users[].hireDate]
 * @param {text} [users[].reportsTo]
 * @param {text} [users[].phoneNumber]
 */
async function bulkUpdateUsers(users) {
	for (const user of users) {
		const { id, ...properties } = user;
		const attributes = Object.entries(properties).map(([key, value]) => ({
			key,
			values: [value === 'empty' ? null : value]
		}));
		await updateUserAttributes(id, attributes);
	}
}

/**
 * @summary Update Manager
 * @description Updates reportsTo field (manager) of a user
 * @param {number} userId - ID of the user to update
 * @param {number} managerId - ID of the manager user to set as reportsTo
 */
async function updateManager(userId, managerId) {
	const url = `/api/content/v2/users/${userId}/teams`;
	const payload = { reportsTo: [{ userId: managerId }] };
	await handleRequest('POST', url, payload);
}

/**
 * @summary Update User Attributes
 * @description Updates specified attributes for a user
 * @param {number} userId - ID of the user to update
 * @param {object[]} attributes - An array of attribute objects, with key and values properties
 * @param {text} attributes[].key
 * @param {text[]} attributes[].values
 */
async function updateUserAttributes(userId, attributes) {
	await handleRequest('PATCH', `/api/identity/v1/users/${userId}`, {
		attributes
	});
}

/**
 * @summary Bulk Update User Roles
 * @description Updates roles for multiple users
 * @param {person[]} people - The people
 * @param {number} roleId - The new role
 */
async function bulkUpdateUserRoles(people, roleId) {
	await handleRequest('PUT', `/api/authorization/v1/roles/${roleId}/users`, people);
}

/**
 * @summary Get Users by Grant
 * @description Get users that have a grant (or grants by comma separated values)
 * @param {text} grant - grant or grants to search for
 * @returns {object[]} users - Array of users that have that grant
 */
async function getUsersByGrant(grant) {
	const limit = 100;
	let offset = 0;
	let hasMoreData = true;
	let users = [];

	while (hasMoreData) {
		let response = await handleRequest(
			'GET',
			`/api/content/v1/typeahead?type=userByEmail&authorities=${grant}&limit=${limit}&offset=${offset}`
		);
		console.log('Response:', response);
		if (!response || !response.users) {
			throw new Error('Invalid response from getUsersByGrant');
		}
		// Cast id to string for consistency
		response.users.forEach((user) => {
			user.id = user.id.toString();
		});

		users.push(...response.users);
		if (response.users.length < limit) {
			hasMoreData = false;
		}
		offset += limit;
	}
	return users;
}

/**
 * @summary Get Group Members
 * @description Gets members of a group
 * @param {number} groupId - ID of the group
 * @returns {object[]} members - Array of users in the group
 */
async function getGroupMembers(groupId) {
	const response = await handleRequest('GET', `/api/content/v2/groups/${groupId}/permissions?includeUsers=true`);
	let members = response.members.filter((m) => m.type != 'GROUP');
	return members;
}

/**
 * @summary Update Group Members
 * @description Updates members of a group
 * @param {number} groupId - ID of the group
 * @param {object[]} addMembers - Array of users to add
 * @param {text} addMembers[].id - The user ID
 * @param {object[]} removeMembers - Array of users to remove
 * @param {text} removeMembers[].id - The user ID
 */
async function updateGroupMembers(groupId, addMembers, removeMembers) {
	// Ensure both arrays have the correct structure
	addMembers = addMembers.map((m) => ({
		id: m.id,
		type: 'USER'
	}));
	removeMembers = removeMembers.map((m) => ({
		id: m.id,
		type: 'USER'
	}));
	// Filter out removeMembers from addMembers
	addMembers = addMembers.filter((m) => !removeMembers.some((r) => r.id === m.id));
	const body = [
		{
			groupId,
			addMembers,
			removeMembers
		}
	];
	await handleRequest('PUT', '/api/content/v2/groups/access', body);
}

/**
 * @summary Convert Group to Dynamic
 * @description Converts a group to a dynamic group with a single attribute-based rule
 * @param {number} id - ID of the group to convert
 * @param {text} value - Attribute value to match for membership
 * @param {text} [key='department'] - Attribute key to match on
 */
async function convertGroupToDynamic(id, value, key = 'department') {
	const body = {
		id,
		type: 'dynamic',
		dynamicDefinition: {
			expression: {
				operator: 'AND',
				operands: [{ key, value }]
			}
		}
	};
	await handleRequest('PUT', `/api/content/v2/groups/${id}`, body);
}

/**
 * @summary Search Users
 * @description Search for users
 * @param {object} query - The query to search for
 * @param {text} query.field - Field to filter on (e.g., reportsTo)
 * @param {text[]} query.values - Values to filter on
 * @param {text} query.operator - Filter operator (e.g., EQ)
 * @param {text} query.filterType - Filter type (e.g., value)
 * @returns {User[]} users - Array of users that match the query
 */
async function searchUsers(query) {
	const limit = 100;
	let offset = 0;
	let allUsers = [];
	let hasMoreData = true;

	while (hasMoreData) {
		const body = {
			cacheBuster: new Date().getTime(),
			showCount: true,
			count: false,
			includeDeleted: false,
			onlyDeleted: false,
			includeSupport: false,
			offset,
			limit,
			sort: {
				field: 'created',
				order: 'DESC'
			},
			filters: [query],
			parts: ['DETAILED']
		};
		const response = await handleRequest('POST', `api/identity/v1/users/search?explain=false`, body);
		try {
			const users = response.users;

			const formattedUsers = users.map((user) =>
				user.attributes.reduce(
					(map, obj) => ({
						...map,
						[obj.key]: Array.isArray(obj.values) ? obj.values[0] : undefined
					}),
					{}
				)
			);
			allUsers.push(...formattedUsers);

			const totalCount = response.count;
			if (response.users.length < limit) {
				hasMoreData = false;
			}
			if (totalCount && allUsers.length < totalCount) {
				offset += limit;
			}
		} catch (error) {
			console.error('Error processing user attributes:', error);
			hasMoreData = false;
		}
	}
	return allUsers;
}

/**
 * @summary Get Person
 * @description Get a user object from a person object
 * @param {person} person - The person
 * @returns {User} user - Information about the person
 */
async function getPerson(person) {
	const response = await handleRequest('GET', `api/identity/v1/users/${person}?parts=detailed`);
	try {
		const users = response.users;
		const firstUser = users[0];
		const attributes = firstUser.attributes;

		if (!attributes || !attributes.length) return undefined;

		const user = attributes.reduce(
			(map, obj) => ({
				...map,
				[obj.key]: Array.isArray(obj.values) ? obj.values[0] : undefined
			}),
			{}
		);
		return user;
	} catch (error) {
		console.error('Error processing user attributes:', error);
		return undefined;
	}
}

/**
 * @summary Cast User ID to Person
 * @description Casts a string User ID to a person object
 * @param {text} userId - ID of the user
 * @returns {person} person - Person object
 */
async function castUserIdToPerson(userId) {
	return userId;
}

/**
 * @summary Cast User ID Number to Person
 * @description Casts an integer User ID to a person object
 * @param {number} userId - ID of the user
 * @returns {person} person - Person object
 */
async function castUserIdNumToPerson(userId) {
	return userId.toString();
}

/**
 * @summary Cast User ID List to Person List
 * @description Casts an array of text User IDs to an array of person objects
 * @param {text[]} userIds - IDs of the users
 * @returns {person[]} persons - Array of person objects
 */
async function castUserIdListToPersonList(userIds) {
	return userIds;
}

/**
 * @summary Cast User ID Number List to Person List
 * @description Casts an array of integer User IDs to an array of person objects
 * @param {number[]} userIds - IDs of the users
 * @returns {person[]} persons - Array of person objects
 */
async function castUserIdNumListToPersonList(userIds) {
	return userIds.map(String);
}

/**
 * @summary Concat Number List
 * @description Concatenates a list of numbers into a text string separated by the specified separator
 * @param {number[]} list - Array of integers
 * @param {text} [separator=','] - Separator to use between numbers
 * @returns {text} concatenatedList - Concatenated string of integers
 */
async function concatNumList(list, separator = ',') {
	return list.join(separator);
}

/**
 * @summary Add Object to List
 * @description Appends an object to an array of objects
 * @param {object} object - Object to append
 * @param {object[]} list - Array of objects to append to
 * @returns {object[]} newList - Resulting array of objects
 */
async function addObjectToList(object, list = []) {
	if (list.length) {
		return list.concat(object);
	} else {
		return [object];
	}
}

/**
 * @summary Add String to List
 * @description Appends a string to an array of strings
 * @param {text} string - String to append
 * @param {text[]} list - Array of strings to append to
 * @returns {text[]} newList - Resulting array of strings
 */
async function addStringToList(string, list = []) {
	if (list.length) {
		return list.concat(string);
	} else {
		return [string];
	}
}

/**
 * @summary Check Empty Object
 * @description Checks if an object is empty
 * @param {object} obj - Object to check
 * @returns {boolean} empty - Whether the obj is empty or not
 */
function checkEmptyObject(obj = {}) {
	return Object.keys(obj).length === 0;
}

/**
 * @summary Read Account Credentials
 * @description Returns account properties with secrets exposed
 * @param {account} account - Account to return properties from
 * @returns {object} result - Account properties
 */
async function readAccountCredentials(account) {
	const acc = await codeengine.getAccount(account.id);
	return acc.properties;
}
