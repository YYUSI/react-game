'use strict';

const React = require('react');
const ReactDOM = require('react-dom')
const when = require('when');
const client = require('./client');

const follow = require('./follow'); // function to hop multiple links by "rel"

const stompClient = require('./websocket-listener');

const root = '/api';

class App extends React.Component {

	constructor(props) {
		super(props);
		this.state = {players: [], attributes: [], page: 1, pageSize: 2, links: {}};
		this.updatePageSize = this.updatePageSize.bind(this);
		this.onCreate = this.onCreate.bind(this);
		this.onUpdate = this.onUpdate.bind(this);
		this.onDelete = this.onDelete.bind(this);
		this.onNavigate = this.onNavigate.bind(this);
		this.refreshCurrentPage = this.refreshCurrentPage.bind(this);
		this.refreshAndGoToLastPage = this.refreshAndGoToLastPage.bind(this);
	}

	loadFromServer(pageSize) {
		follow(client, root, [
				{rel: 'players', params: {size: pageSize}}]
		).then(playerCollection => {
				return client({
					method: 'GET',
					path: playerCollection.entity._links.profile.href,
					headers: {'Accept': 'application/schema+json'}
				}).then(schema => {
					this.schema = schema.entity;
					this.links = playerCollection.entity._links;
					return playerCollection;
				});
		}).then(playerCollection => {
			this.page = playerCollection.entity.page;
			return playerCollection.entity._embedded.players.map(player =>
					client({
						method: 'GET',
						path: player._links.self.href
					})
			);
		}).then(playerPromises => {
			return when.all(playerPromises);
		}).done(players => {
			this.setState({
				page: this.page,
				players: players,
				attributes: Object.keys(this.schema.properties),
				pageSize: pageSize,
				links: this.links
			});
		});
	}

	// tag::on-create[]
	onCreate(newPlayer) {
		follow(client, root, ['players']).done(response => {
			client({
				method: 'POST',
				path: response.entity._links.self.href,
				entity: newPlayer,
				headers: {'Content-Type': 'application/json'}
			})
		})
	}
	// end::on-create[]

	onUpdate(player, updatedPlayer) {
		client({
			method: 'PUT',
			path: player.entity._links.self.href,
			entity: updatedPlayer,
			headers: {
				'Content-Type': 'application/json',
				'If-Match': player.headers.Etag
			}
		}).done(response => {
			/* Let the websocket handler update the state */
		}, response => {
			if (response.status.code === 412) {
				alert('DENIED: Unable to update ' + player.entity._links.self.href + '. Your copy is stale.');
			}
		});
	}

	onDelete(player) {
		client({method: 'DELETE', path: player.entity._links.self.href});
	}

	onNavigate(navUri) {
		client({
			method: 'GET',
			path: navUri
		}).then(playerCollection => {
			this.links = playerCollection.entity._links;
			this.page = playerCollection.entity.page;

			return playerCollection.entity._embedded.player.map(player =>
					client({
						method: 'GET',
						path: player._links.self.href
					})
			);
		}).then(playerPromises => {
			return when.all(playerPromises);
		}).done(players => {
			this.setState({
				page: this.page,
				players: players,
				attributes: Object.keys(this.schema.properties),
				pageSize: this.state.pageSize,
				links: this.links
			});
		});
	}

	updatePageSize(pageSize) {
		if (pageSize !== this.state.pageSize) {
			this.loadFromServer(pageSize);
		}
	}

	// tag::websocket-handlers[]
	refreshAndGoToLastPage(message) {
		follow(client, root, [{
			rel: 'players',
			params: {size: this.state.pageSize}
		}]).done(response => {
			if (response.entity._links.last !== undefined) {
				this.onNavigate(response.entity._links.last.href);
			} else {
				this.onNavigate(response.entity._links.self.href);
			}
		})
	}

	refreshCurrentPage(message) {
		follow(client, root, [{
			rel: 'players',
			params: {
				size: this.state.pageSize,
				page: this.state.page.number
			}
		}]).then(playerCollection => {
			this.links = playerCollection.entity._links;
			this.page = playerCollection.entity.page;

			return playerCollection.entity._embedded.players.map(player => {
				return client({
					method: 'GET',
					path: player._links.self.href
				})
			});
		}).then(playerPromises => {
			return when.all(playerPromises);
		}).then(players => {
			this.setState({
				page: this.page,
				players: players,
				attributes: Object.keys(this.schema.properties),
				pageSize: this.state.pageSize,
				links: this.links
			});
		});
	}
	// end::websocket-handlers[]

	// tag::register-handlers[]
	componentDidMount() {
		this.loadFromServer(this.state.pageSize);
		stompClient.register([
			{route: '/topic/newPlayer', callback: this.refreshAndGoToLastPage},
			{route: '/topic/updatePlayer', callback: this.refreshCurrentPage},
			{route: '/topic/deletePlayer', callback: this.refreshCurrentPage}
		]);
	}
	// end::register-handlers[]

	render() {
		return (
			<div>
				<CreateDialog attributes={this.state.attributes} onCreate={this.onCreate}/>
				<PlayerList page={this.state.page}
							  players={this.state.players}
							  links={this.state.links}
							  pageSize={this.state.pageSize}
							  attributes={this.state.attributes}
							  onNavigate={this.onNavigate}
							  onUpdate={this.onUpdate}
							  onDelete={this.onDelete}
							  updatePageSize={this.updatePageSize}/>
			</div>
		)
	}
}

class CreateDialog extends React.Component {

	constructor(props) {
		super(props);
		this.handleSubmit = this.handleSubmit.bind(this);
	}

	handleSubmit(e) {
		e.preventDefault();
		var newPlayer = {};
		this.props.attributes.forEach(attribute => {
			newPlayer[attribute] = ReactDOM.findDOMNode(this.refs[attribute]).value.trim();
		});
		this.props.onCreate(newPlayer);
		this.props.attributes.forEach(attribute => {
			ReactDOM.findDOMNode(this.refs[attribute]).value = ''; // clear out the dialog's inputs
		});
		window.location = "#";
	}

	render() {
		var inputs = this.props.attributes.map(attribute =>
				<p key={attribute}>
					<input type="text" placeholder={attribute} ref={attribute} className="field" />
				</p>
		);
		return (
			<div>
				<a href="#createPlayer">Create</a>

				<div id="createPlayer" className="modalDialog">
					<div>
						<a href="#" title="Close" className="close">X</a>

						<h2>Create new player</h2>

						<form>
							{inputs}
							<button onClick={this.handleSubmit}>Create</button>
						</form>
					</div>
				</div>
			</div>
		)
	}
}

class UpdateDialog extends React.Component {

	constructor(props) {
		super(props);
		this.handleSubmit = this.handleSubmit.bind(this);
	}

	handleSubmit(e) {
		e.preventDefault();
		var updatedPlayer = {};
		this.props.attributes.forEach(attribute => {
			updatedPlayer[attribute] = ReactDOM.findDOMNode(this.refs[attribute]).value.trim();
		});
		this.props.onUpdate(this.props.player, updatedPlayer);
		window.location = "#";
	}

	render() {
		var inputs = this.props.attributes.map(attribute =>
				<p key={this.props.player.entity[attribute]}>
					<input type="text" placeholder={attribute}
						   defaultValue={this.props.player.entity[attribute]}
						   ref={attribute} className="field" />
				</p>
		);

		var dialogId = "updatePlayer-" + this.props.player.entity._links.self.href;

		return (
			<div>
				<a href={"#" + dialogId}>Update</a>

				<div id={dialogId} className="modalDialog">
					<div>
						<a href="#" title="Close" className="close">X</a>

						<h2>Update an player</h2>

						<form>
							{inputs}
							<button onClick={this.handleSubmit}>Update</button>
						</form>
					</div>
				</div>
			</div>
		)
	}

}

class PlayerList extends React.Component {

	constructor(props) {
		super(props);
		this.handleNavFirst = this.handleNavFirst.bind(this);
		this.handleNavPrev = this.handleNavPrev.bind(this);
		this.handleNavNext = this.handleNavNext.bind(this);
		this.handleNavLast = this.handleNavLast.bind(this);
		this.handleInput = this.handleInput.bind(this);
	}

	handleInput(e) {
		e.preventDefault();
		var pageSize = ReactDOM.findDOMNode(this.refs.pageSize).value;
		if (/^[0-9]+$/.test(pageSize)) {
			this.props.updatePageSize(pageSize);
		} else {
			ReactDOM.findDOMNode(this.refs.pageSize).value = pageSize.substring(0, pageSize.length - 1);
		}
	}

	handleNavFirst(e) {
		e.preventDefault();
		this.props.onNavigate(this.props.links.first.href);
	}

	handleNavPrev(e) {
		e.preventDefault();
		this.props.onNavigate(this.props.links.prev.href);
	}

	handleNavNext(e) {
		e.preventDefault();
		this.props.onNavigate(this.props.links.next.href);
	}

	handleNavLast(e) {
		e.preventDefault();
		this.props.onNavigate(this.props.links.last.href);
	}

	render() {
		var pageInfo = this.props.page.hasOwnProperty("number") ?
			<h3>Players - Page {this.props.page.number + 1} of {this.props.page.totalPages}</h3> : null;

		var players = this.props.players.map(player =>
			<Player key={player.entity._links.self.href}
					  player={player}
					  attributes={this.props.attributes}
					  onUpdate={this.props.onUpdate}
					  onDelete={this.props.onDelete}/>
		);

		var navLinks = [];
		if ("first" in this.props.links) {
			navLinks.push(<button key="first" onClick={this.handleNavFirst}>&lt;&lt;</button>);
		}
		if ("prev" in this.props.links) {
			navLinks.push(<button key="prev" onClick={this.handleNavPrev}>&lt;</button>);
		}
		if ("next" in this.props.links) {
			navLinks.push(<button key="next" onClick={this.handleNavNext}>&gt;</button>);
		}
		if ("last" in this.props.links) {
			navLinks.push(<button key="last" onClick={this.handleNavLast}>&gt;&gt;</button>);
		}

		return (
			<div>
				{pageInfo}
				<input ref="pageSize" defaultValue={this.props.pageSize} onInput={this.handleInput}/>
				<table>
					<tbody>
						<tr>
							<th>First Name</th>
							<th>Last Name</th>
							<th>Description</th>
							<th></th>
							<th></th>
						</tr>
						{players}
					</tbody>
				</table>
				<div>
					{navLinks}
				</div>
			</div>
		)
	}
}

class Player extends React.Component {

	constructor(props) {
		super(props);
		this.handleDelete = this.handleDelete.bind(this);
	}

	handleDelete() {
		this.props.onDelete(this.props.player);
	}

	render() {
		return (
			<tr>
				<td>{this.props.player.entity.firstName}</td>
				<td>{this.props.player.entity.lastName}</td>
				<td>{this.props.player.entity.description}</td>
				<td>
					<UpdateDialog player={this.props.player}
								  attributes={this.props.attributes}
								  onUpdate={this.props.onUpdate}/>
				</td>
				<td>
					<button onClick={this.handleDelete}>Delete</button>
				</td>
			</tr>
		)
	}
}

ReactDOM.render(
	<App />,
	document.getElementById('react')
)
